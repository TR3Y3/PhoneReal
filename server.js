const express = require('express');
const path = require('path');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const areaCodes = require('./data/area-codes.json');
const { getCachedResult, setCachedResult, incrementMonthlyUsage, getMonthlyUsage } = require('./cache');

const app = express();
const PORT = process.env.PORT || 3000;

const ABSTRACT_API_KEY = process.env.ABSTRACT_API_KEY;
const ABSTRACT_CONFIGURED = Boolean(ABSTRACT_API_KEY);
const ABSTRACT_MONTHLY_SOFT_CAP = 95; // stay under the real 100/month limit

const VERIPHONE_API_KEY = process.env.VERIPHONE_API_KEY;
const VERIPHONE_CONFIGURED = Boolean(VERIPHONE_API_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LINE_TYPE_LABELS = {
  mobile: 'Mobile',
  landline: 'Landline',
  fixed_line: 'Landline',
  fixed_line_or_mobile: 'Mobile or Landline',
  voip: 'VOIP / Internet Phone',
  'toll-free': 'Toll-Free',
  toll_free: 'Toll-Free',
  premium_rate: 'Premium-Rate',
  pager: 'Pager',
  unknown: 'Unknown',
};

function lookupAreaCode(nationalNumber, country) {
  if (country !== 'US' && country !== 'CA') return null;
  const npa = String(nationalNumber).slice(0, 3);
  const entry = areaCodes[npa];
  if (!entry) return null;
  return {
    areaCode: npa,
    city: entry.city,
    state: entry.state,
    stateCode: entry.stateCode,
  };
}

// Offline spoof-signature checks. These don't prove a number was used to spoof
// (no such public database exists), but they catch the shapes that fake caller
// ID commonly takes.
function offlineSpoofSignals(phoneNumber) {
  const signals = [];
  const national = String(phoneNumber.nationalNumber);

  // Right shape, but not in any range a carrier has been assigned. Spoofers
  // routinely generate these because no real subscriber can answer them.
  if (!phoneNumber.isValid() && phoneNumber.isPossible()) {
    signals.push({
      severity: 'high',
      label: 'Unassigned number range',
      detail: 'Correct length, but not in a block any carrier has been allocated — a common fake caller-ID signature.',
    });
  }

  // 555 exchange is reserved for fiction/testing in the US and Canada.
  if ((phoneNumber.country === 'US' || phoneNumber.country === 'CA') && national.slice(3, 6) === '555') {
    signals.push({
      severity: 'high',
      label: 'Reserved 555 exchange',
      detail: 'The 555 exchange is reserved for fictional/test use — not a real reachable line.',
    });
  }

  // Repdigits and straight runs (1111111111, 1234567890) are placeholder junk.
  if (/^(\d)\1+$/.test(national)) {
    signals.push({
      severity: 'high',
      label: 'Repeated-digit number',
      detail: 'Every digit is identical — placeholder or fabricated entry, not a real line.',
    });
  } else if ('01234567890'.includes(national) || '09876543210'.includes(national)) {
    signals.push({
      severity: 'medium',
      label: 'Sequential-digit number',
      detail: 'Digits run in sequence — typically a fabricated or junk entry.',
    });
  }

  return signals;
}

// Merges live provider risk data with the offline signals into one ranked list.
function buildRiskFlags(result, phoneNumber) {
  const flags = [...offlineSpoofSignals(phoneNumber)];

  if (result) {
    if (result.risk && result.risk.abuseDetected) {
      flags.push({
        severity: 'high',
        label: 'Abuse reports on file',
        detail: 'This number has been reported for spam, scam, or spoofing activity.',
      });
    }

    if (result.risk && result.risk.disposable) {
      flags.push({
        severity: 'high',
        label: 'Disposable / burner number',
        detail: 'Belongs to a temporary-number service — frequently used to mask identity.',
      });
    }

    if (result.lineStatus && result.lineStatus !== 'active') {
      flags.push({
        severity: 'medium',
        label: `Line not active (${result.lineStatus})`,
        detail: 'The line is not currently in service, so live caller ID from it would be suspect.',
      });
    }

    if (result.isVoip === true) {
      flags.push({
        severity: 'medium',
        label: 'VOIP line',
        detail: 'Internet phone lines are legitimate, but are also the easiest to spoof caller ID from.',
      });
    }

    if (result.breaches && result.breaches.total > 0) {
      flags.push({
        severity: 'low',
        label: `Appeared in ${result.breaches.total} data breach${result.breaches.total === 1 ? '' : 'es'}`,
        detail: 'Exposed in a public breach, so it may be circulating on spam and scam lists.',
      });
    }

    if (result.risk && result.risk.level === 'high') {
      flags.push({
        severity: 'high',
        label: 'Provider rates this number high-risk',
        detail: "The carrier-data provider's own fraud scoring flagged this number.",
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return flags;
}

async function abstractLookup(e164Number) {
  const url = `https://phoneintelligence.abstractapi.com/v1/?api_key=${encodeURIComponent(
    ABSTRACT_API_KEY
  )}&phone=${encodeURIComponent(e164Number)}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    const err = new Error(data.error && data.error.message ? data.error.message : 'Abstract API request failed');
    err.status = response.status;
    throw err;
  }

  const validation = data.phone_validation || {};
  const carrierInfo = data.phone_carrier || {};
  const loc = data.phone_location || {};
  const risk = data.phone_risk || {};
  const breaches = data.phone_breaches || {};
  const lineType = carrierInfo.line_type || null;

  return {
    source: 'abstract',
    valid: validation.is_valid,
    isVoip: typeof validation.is_voip === 'boolean' ? validation.is_voip : null,
    lineStatus: validation.line_status || null,
    country: loc.country_code || null,
    carrier: carrierInfo.name || null,
    type: lineType ? { raw: lineType, label: LINE_TYPE_LABELS[lineType] || lineType } : null,
    location: loc.city || loc.region ? { city: loc.city, state: loc.region } : null,
    risk: {
      level: risk.risk_level || null,
      disposable: Boolean(risk.is_disposable),
      abuseDetected: Boolean(risk.is_abuse_detected),
    },
    breaches: {
      total: typeof breaches.total_breaches === 'number' ? breaches.total_breaches : null,
      firstBreached: breaches.date_first_breached || null,
      lastBreached: breaches.date_last_breached || null,
    },
  };
}

async function veriphoneLookup(e164Number) {
  const url = `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(
    e164Number
  )}&key=${encodeURIComponent(VERIPHONE_API_KEY)}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.status === 'error') {
    const err = new Error('Veriphone request failed');
    err.status = response.status;
    throw err;
  }

  const lineType = data.phone_type || null;
  // Veriphone only asserts VOIP when it explicitly says so; anything ambiguous
  // (e.g. "fixed_line_or_mobile") is left unknown rather than guessed.
  const isVoip = lineType === 'voip' ? true : lineType && lineType !== 'fixed_line_or_mobile' ? false : null;

  return {
    source: 'veriphone',
    valid: Boolean(data.phone_valid),
    isVoip,
    country: data.country_code || null,
    carrier: data.carrier || null,
    type: lineType ? { raw: lineType, label: LINE_TYPE_LABELS[lineType] || lineType } : null,
    location: data.phone_region ? { city: null, state: data.phone_region } : null,
    lineStatus: null,
    risk: null,
    breaches: null,
  };
}

app.post('/api/verify', async (req, res) => {
  const raw = (req.body && req.body.phone ? String(req.body.phone) : '').trim();
  if (!raw) {
    return res.status(400).json({ error: 'Enter a phone number.' });
  }

  const phoneNumber = parsePhoneNumberFromString(raw, 'US');

  if (!phoneNumber || !phoneNumber.isPossible()) {
    return res.json({
      input: raw,
      valid: false,
      reason: "Doesn't match any recognizable phone number format.",
      accurate: true,
    });
  }

  const country = phoneNumber.country;
  const area = lookupAreaCode(phoneNumber.nationalNumber, country);
  const national = phoneNumber.formatNational();
  const international = phoneNumber.formatInternational();
  const e164 = phoneNumber.number;

  if (!ABSTRACT_CONFIGURED && !VERIPHONE_CONFIGURED) {
    return res.json({
      input: raw,
      accurate: false,
      setupNeeded: true,
      valid: phoneNumber.isValid(),
      country: country || null,
      national,
      international,
      e164,
      location: area,
      flags: buildRiskFlags(null, phoneNumber),
      message:
        'Carrier-grade verification is not configured yet on this server. Formatting/location shown below only — line type (mobile/landline/VOIP) is unavailable until an API key is added.',
    });
  }

  const cached = await getCachedResult(e164);
  if (cached) {
    return res.json({ ...cached, input: raw, national, international, e164, cached: true });
  }

  let result = null;
  let lookupError = null;

  const abstractUsage = ABSTRACT_CONFIGURED ? await getMonthlyUsage('abstract') : null;
  const abstractAvailable = ABSTRACT_CONFIGURED && (abstractUsage === null || abstractUsage < ABSTRACT_MONTHLY_SOFT_CAP);

  if (abstractAvailable) {
    try {
      result = await abstractLookup(e164);
      await incrementMonthlyUsage('abstract');
    } catch (err) {
      console.error('Abstract Lookup error:', err.status, err.message);
      lookupError = err;
    }
  }

  if (!result && VERIPHONE_CONFIGURED) {
    try {
      result = await veriphoneLookup(e164);
      await incrementMonthlyUsage('veriphone');
      lookupError = null;
    } catch (err) {
      console.error('Veriphone Lookup error:', err.status, err.message);
      lookupError = err;
    }
  }

  if (!result) {
    if (lookupError) {
      return res.status(502).json({
        error: 'Verification service is temporarily unavailable. Try again in a moment.',
      });
    }
    return res.json({
      input: raw,
      accurate: false,
      setupNeeded: true,
      valid: phoneNumber.isValid(),
      country: country || null,
      national,
      international,
      e164,
      location: area,
      flags: buildRiskFlags(null, phoneNumber),
      message: 'Monthly verification quota reached on all configured providers. Showing offline data only.',
    });
  }

  const flags = buildRiskFlags(result, phoneNumber);

  const payload = {
    accurate: true,
    valid: result.valid,
    isVoip: result.isVoip,
    country: result.country || country || null,
    carrier: result.carrier,
    type: result.type,
    location: result.location || area,
    risk: result.risk,
    breaches: result.breaches,
    flags,
    riskSummary: {
      // 'clear' only when a real provider answered and found nothing.
      status: flags.some((f) => f.severity === 'high')
        ? 'alert'
        : flags.length > 0
          ? 'caution'
          : 'clear',
      highCount: flags.filter((f) => f.severity === 'high').length,
      partial: result.source === 'veriphone', // backup provider has no risk data
    },
  };

  await setCachedResult(e164, payload);

  return res.json({ ...payload, input: raw, national, international, e164 });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, abstractConfigured: ABSTRACT_CONFIGURED, veriphoneConfigured: VERIPHONE_CONFIGURED });
});

app.listen(PORT, () => {
  console.log(
    `PhoneReal listening on port ${PORT} (abstract: ${ABSTRACT_CONFIGURED}, veriphone: ${VERIPHONE_CONFIGURED})`
  );
});
