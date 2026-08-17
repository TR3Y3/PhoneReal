const express = require('express');
const path = require('path');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const areaCodes = require('./data/area-codes.json');

const app = express();
const PORT = process.env.PORT || 3000;

const ABSTRACT_API_KEY = process.env.ABSTRACT_API_KEY;
const ABSTRACT_CONFIGURED = Boolean(ABSTRACT_API_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LINE_TYPE_LABELS = {
  mobile: 'Mobile',
  landline: 'Landline',
  voip: 'VOIP / Internet Phone',
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
  const url = `https://phonevalidation.abstractapi.com/v1/?api_key=${encodeURIComponent(
    ABSTRACT_API_KEY
  )}&phone=${encodeURIComponent(e164Number)}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    const err = new Error(data.error && data.error.message ? data.error.message : 'Abstract API request failed');
    err.status = response.status;
    throw err;
  }

  return data;
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

  if (!ABSTRACT_CONFIGURED) {
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

  try {
    const result = await abstractLookup(e164);
    const lineType = result.type || null;

    return res.json({
      input: raw,
      accurate: true,
      valid: result.valid,
      country: (result.country && result.country.code) || country || null,
      national,
      international,
      e164,
      carrier: result.carrier || null,
      type: lineType
        ? { raw: lineType, label: LINE_TYPE_LABELS[lineType] || lineType }
        : null,
      location: area,
    });
  } catch (err) {
    console.error('Abstract API Lookup error:', err.status, err.message);
    return res.status(502).json({
      error: 'Verification service is temporarily unavailable. Try again in a moment.',
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, accurateMode: ABSTRACT_CONFIGURED });
});

app.listen(PORT, () => {
  console.log(`PhoneReal listening on port ${PORT} (accurate mode: ${ABSTRACT_CONFIGURED})`);
});
