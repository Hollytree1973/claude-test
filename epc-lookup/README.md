# Gibsons EPC Lookup

A small, free, on-site EPC lookup tool that pairs with the Gibsons Report Writer
Claude Project. Enter a property **number or name** + **postcode**; it queries the
government EPC register, matches the right property flexibly, and gives you the
full EPC plus a "copy for report" block and a Google Maps link.

It runs entirely in the browser (works on iPad), uses **no Claude tokens**, and
calls only the **free** government EPC Open Data API via a tiny proxy.

## Why a proxy?

The EPC Open Data API needs an authenticated key and does **not** allow direct
browser calls (no CORS). The included Cloudflare Worker (`worker.js`) holds your
key securely and adds the CORS header. Cloudflare's free tier (100k requests/day)
is genuinely free — no per-use billing.

## Setup (one-time, ~10 minutes)

1. **Get a free EPC API key** at <https://epc.opendatacommunities.org/> →
   register for the Domestic API. You'll get an email address + API token.
2. **Deploy the proxy:**
   - Create a free Cloudflare account → **Workers & Pages → Create Worker**.
   - Paste the contents of `worker.js` and **Deploy**.
   - Add two secrets (**Settings → Variables and Secrets**):
     `EPC_EMAIL` (the email you registered with) and `EPC_KEY` (the token).
   - Copy the Worker URL, e.g. `https://gibsons-epc.<you>.workers.dev`.
3. **Point the page at the proxy:** open `index.html` (hosted on your GitHub
   Pages site at `/epc-lookup/`, or locally), open **Settings**, paste the Worker
   URL, and **Save**. Stored on the device only.

## Daily use

1. Open the page (add it to your iPad home screen for one-tap access).
2. Enter the property number/name and postcode → **Find EPC**.
3. One match loads automatically; several show a dropdown; none shows
   *"No EPC found for this property — verify manually."*
4. Tap **Copy for report** and paste the EPC block into your draft.

## Matching logic

- A **number** matches as a whole token — `45` matches "45 James Lane" but not
  "145 James Lane".
- A **name** matches as a substring — `Rose` matches "Rose Cottage".
- Tries the full property identifier against all certificates returned for the
  postcode, so an imperfect address still resolves.
