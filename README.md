# PhoneReal

Internal tool for the sales floor: type a phone number, get back validity,
a direct VOIP yes/no, line type (mobile / landline / VOIP), carrier,
live location, and a basic risk flag (disposable/abuse).

Validity + formatting + area-code location run offline for free, always.
Everything carrier-related calls the Abstract API **Phone Intelligence**
endpoint — a live carrier-database check, which is the only way to get
real VOIP detection (no free/offline data source can do this reliably).
Abstract's free tier is **100 lookups/month, forever, no credit card
required** — signup only needs an email, no phone number. If you outgrow
that, paid tiers start around $19/month; there's no trial-credit cliff to
manage.

## One-time setup (5 minutes)

### 1. Get an Abstract API key
1. Go to https://www.abstractapi.com/api/phone-intelligence and sign up
   (email only — no phone number, no credit card).
2. Copy your API key from the dashboard.

### 2. Deploy to Render
1. Go to https://dashboard.render.com/blueprints and click **New Blueprint
   Instance**.
2. Connect this GitHub repo (`tr3y3/phonereal`) — Render detects
   `render.yaml` automatically.
3. When prompted for an environment variable, paste in `ABSTRACT_API_KEY`.
4. Click **Apply**. Render builds and gives you a public URL
   (e.g. `https://phonereal.onrender.com`) — share that with the sales floor.

No code to touch. Every future push to this branch redeploys automatically.

Note: Render's free plan spins the service down after 15 minutes of no
traffic, so the first request after idle time takes a few extra seconds to
wake up. Upgrade to a paid Render instance later if that matters for your
floor.

## Local development

```bash
npm install
export ABSTRACT_API_KEY=xxxx
npm start
# open http://localhost:3000
```

Without `ABSTRACT_API_KEY` set, the app still runs and shows validity/
formatting/location, but clearly flags that line-type detection isn't
active yet — it never fakes a VOIP/mobile/landline answer it doesn't have.

## How accurate is this?

- **Validity & formatting** — always accurate (Google's `libphonenumber`
  library, same data real phone systems use to validate number shape).
- **VOIP flag & line type (mobile/landline/VOIP)** — accurate once
  `ABSTRACT_API_KEY` is set; this is a live carrier-database check, not a
  guess.
- **Location** — with a key set, this is Abstract's live carrier-registered
  city/region. Without a key, it falls back to the area code's *original*
  assignment, which is only a hint since mobile numbers are portable.
- **Risk level / disposable flag** — a bonus signal from the same API call
  (e.g. flags burner/temporary numbers), shown when Abstract returns it.

## Attribution

`data/area-codes.json` is vendored from the MIT-licensed
[`areacodes`](https://github.com/BlueRival/node-areacodes) package.
