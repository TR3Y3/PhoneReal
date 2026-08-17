# PhoneReal

Internal tool for the sales floor: type a phone number, get back validity,
line type (mobile / landline / VOIP / toll-free), carrier, and originally
assigned location.

Validity + formatting + area-code location run offline for free. Line type
(the VOIP check) calls the Twilio Lookup API, which is the only accurate
source for that — it queries the FCC's number portability database, which
no free service has access to. Twilio's free trial credit covers roughly
1,500+ lookups before it needs a card on file; after that it's about
$0.005 per lookup.

## One-time setup (5 minutes)

### 1. Get Twilio keys
1. Go to https://www.twilio.com/try-twilio and create a free account (no
   charge, trial credit included automatically).
2. On the Twilio Console dashboard (https://console.twilio.com), copy your
   **Account SID** and **Auth Token**.

### 2. Deploy to Render
1. Go to https://dashboard.render.com/blueprints and click **New Blueprint
   Instance**.
2. Connect this GitHub repo (`tr3y3/phonereal`) — Render will detect
   `render.yaml` automatically.
3. When prompted for environment variables, paste in:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
4. Click **Apply**. Render builds and gives you a public URL
   (e.g. `https://phonereal.onrender.com`) — share that with the sales floor.

That's it — no code to touch. Every future push to this branch redeploys
automatically.

Note: Render's free plan spins the service down after 15 minutes of no
traffic, so the first request after idle time takes a few extra seconds to
wake up. Upgrade to a paid Render instance later if that matters for your
floor.

## Local development

```bash
npm install
export TWILIO_ACCOUNT_SID=xxxx
export TWILIO_AUTH_TOKEN=xxxx
npm start
# open http://localhost:3000
```

Without the Twilio env vars set, the app still runs and shows validity/
formatting/location, but clearly flags that line-type detection isn't
active yet.

## How accurate is this?

- **Validity & formatting** — always accurate (Google's `libphonenumber`
  library, same data real phone systems use to validate number shape).
- **Line type (mobile/landline/VOIP)** — accurate once Twilio keys are
  configured; this is a live carrier-database check, not a guess.
- **Location** — reflects the area code's *original* assignment, not the
  current owner's location. Mobile numbers are portable, so treat this as
  a strong hint, not a guarantee.

## Attribution

`data/area-codes.json` is vendored from the MIT-licensed
[`areacodes`](https://github.com/BlueRival/node-areacodes) package.
