# PhoneReal

Internal tool for the sales floor: type a phone number, get back validity,
a direct VOIP yes/no, line type (mobile / landline / VOIP), carrier,
live location, and a basic risk flag (disposable/abuse).

Validity + formatting + area-code location run offline for free, always.
Everything carrier-related calls **Abstract API** first (Phone Intelligence
endpoint), and automatically fails over to **Veriphone** if Abstract's
monthly quota is used up — reps never see the difference, results just
keep coming. A cache remembers every number checked for 60 days, so
re-checking the same lead costs nothing.

- **Abstract**: 100 lookups/month, forever, free, email-only signup.
- **Veriphone**: 1,000 lookups/month, forever, free, email-only signup.
- Combined + caching: comfortably past 1,500/month for most sales floors
  without paying anything.

## One-time setup (10 minutes)

### 1. Get an Abstract API key
1. Go to https://www.abstractapi.com/api/phone-intelligence and sign up
   (email only — no phone number, no credit card).
2. Copy your API key from the dashboard.

### 2. Get a Veriphone API key
1. Go to https://veriphone.io and sign up (email only, no card).
2. Copy your API key from the dashboard.

### 3. Deploy to Render
1. Go to https://dashboard.render.com/blueprints and click **New Blueprint
   Instance**.
2. Connect this GitHub repo (`tr3y3/phonereal`) — Render detects
   `render.yaml` automatically, including a free Key Value (cache) instance.
3. When prompted for environment variables, paste in `ABSTRACT_API_KEY` and
   `VERIPHONE_API_KEY`.
4. Click **Apply**. Render builds and gives you a public URL
   (e.g. `https://phonereal.onrender.com`) — share that with the sales floor.

If you're adding this to an **already-deployed** service instead of a fresh
Blueprint: open the Render dashboard → the Blueprint → **Manual Sync** to
provision the new Key Value cache, then add `VERIPHONE_API_KEY` as an env
var on the web service, then **Manual Deploy → Deploy latest commit** to
make sure it's actually running the current code (Render doesn't always
auto-redeploy promptly — always double check the deploy history if
something looks stale).

No code to touch after that. Every future push to this branch redeploys
automatically (assuming Auto-Deploy is on in the service's Settings tab).

Note: Render's free web service plan spins down after 15 minutes of no
traffic, so the first request after idle time takes a few extra seconds to
wake up. The free Key Value plan is capped at 25MB, which is far more than
enough for a phone-number cache.

## Local development

```bash
npm install
export ABSTRACT_API_KEY=xxxx
export VERIPHONE_API_KEY=xxxx
export REDIS_URL=redis://localhost:6379   # optional — omit to run without caching
npm start
# open http://localhost:3000
```

Without any keys set, the app still runs and shows validity/formatting/
location, but clearly flags that line-type detection isn't active — it
never fakes a VOIP/mobile/landline answer it doesn't have. Without
`REDIS_URL` set, caching and quota tracking are silently skipped (every
lookup goes straight to Abstract) — useful for local testing, not
recommended for production since you'd lose the quota protection.

## How it decides which provider to use

1. Check the cache for this exact number — if found (and under 60 days
   old), return it instantly, no API call spent.
2. Otherwise, check this month's Abstract usage. If it's under 95 (a
   safety margin under the real 100 cap), call Abstract.
3. If Abstract is at its cap, or the Abstract call fails, call Veriphone
   instead.
4. Cache whichever result came back, so the next lookup of that number is
   free regardless of which provider answered.
5. If both providers are exhausted or unconfigured, fall back to the free
   offline check (validity/format/original-location only) rather than
   erroring out.

## How accurate is this?

- **Validity & formatting** — always accurate (Google's `libphonenumber`
  library, same data real phone systems use to validate number shape).
- **VOIP flag & line type (mobile/landline/VOIP)** — accurate when Abstract
  answers (live carrier-database check, not a guess). When Veriphone
  answers as backup, it's usually still accurate, but Veriphone sometimes
  returns an ambiguous "mobile or landline" type for a number instead of a
  clean VOIP yes/no — in that case the VOIP field is shown as unknown
  rather than guessed.
- **Location** — with either key set, this is the provider's live
  carrier-registered city/region. Without any key, it falls back to the
  area code's *original* assignment, which is only a hint since mobile
  numbers are portable.
- **Risk level / disposable flag** — a bonus signal from Abstract only
  (e.g. flags burner/temporary numbers); not available on Veriphone-sourced
  results.

## Attribution

`data/area-codes.json` is vendored from the MIT-licensed
[`areacodes`](https://github.com/BlueRival/node-areacodes) package.
