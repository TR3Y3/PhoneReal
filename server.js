const express = require('express');
const path = require('path');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const areaCodes = require('./data/area-codes.json');

const app = express();
const PORT = process.env.PORT || 3000;

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_CONFIGURED = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LINE_TYPE_LABELS = {
  mobile: 'Mobile',
  landline: 'Landline',
  voip: 'VOIP / Internet Phone',
  nonFixedVoip: 'VOIP / Internet Phone',
  fixedVoip: 'VOIP / Internet Phone',
  personal: 'Personal Number',
  tollFree: 'Toll-Free',
  premium: 'Premium-Rate',
  sharedCost: 'Shared-Cost',
  uan: 'Universal Access Number',
  voicemail: 'Voicemail',
  pager: 'Pager',
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

async function twilioLookup(e164Number) {
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(
    e164Number
  )}?Fields=line_type_intelligence`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });

  const data = await response.json();

  if (!response.ok) {
    const err = new Error(data.message || 'Twilio Lookup request failed');
    err.status = response.status;
    err.twilioCode = data.code;
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

  if (!TWILIO_CONFIGURED) {
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
        'Carrier-grade verification is not configured yet on this server. Formatting/location shown below only — line type (mobile/landline/VOIP) is unavailable until a Twilio API key is added.',
    });
  }

  try {
    const result = await twilioLookup(e164);
    const lineType = result.line_type_intelligence
      ? result.line_type_intelligence.type
      : null;

    return res.json({
      input: raw,
      accurate: true,
      valid: result.valid,
      country: result.country_code || country || null,
      national,
      international,
      e164,
      carrier: result.line_type_intelligence
        ? result.line_type_intelligence.carrier_name || null
        : null,
      type: lineType
        ? { raw: lineType, label: LINE_TYPE_LABELS[lineType] || lineType }
        : null,
      location: area,
    });
  } catch (err) {
    if (err.status === 404) {
      return res.json({
        input: raw,
        accurate: true,
        valid: false,
        national,
        international,
        e164,
        location: area,
      });
    }
    console.error('Twilio Lookup error:', err.status, err.twilioCode, err.message);
    return res.status(502).json({
      error: 'Verification service is temporarily unavailable. Try again in a moment.',
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, accurateMode: TWILIO_CONFIGURED });
});

app.listen(PORT, () => {
  console.log(`PhoneReal listening on port ${PORT} (accurate mode: ${TWILIO_CONFIGURED})`);
});
