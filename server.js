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
  const lineType = carrierInfo.line_type || null;

  return {
    source: 'abstract',
    valid: validation.is_valid,
    isVoip: typeof validation.is_voip === 'boolean' ? validation.is_voip : null,
    country: loc.country_code || null,
    carrier: carrierInfo.name || null,
    type: lineType ? { raw: lineType, label: LINE_TYPE_LABELS[lineType] || lineType } : null,
    location: loc.city || loc.region ? { city: loc.city, state: loc.region } : null,
    risk: {
      level: risk.risk_level || null,
      disposable: Boolean(risk.is_disposable),
      abuseDetected: Boolean(risk.is_abuse_detected),
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
    risk: null,
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
      message: 'Monthly verification quota reached on all configured providers. Showing offline data only.',
    });
  }

  const payload = {
    accurate: true,
    valid: result.valid,
    isVoip: result.isVoip,
    country: result.country || country || null,
    carrier: result.carrier,
    type: result.type,
    location: result.location || area,
    risk: result.risk,
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
