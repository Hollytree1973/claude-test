/**
 * Gibsons EPC proxy — Cloudflare Worker (free tier).
 *
 * Why this exists:
 *   The government EPC Open Data API requires an authenticated key and does NOT
 *   send CORS headers, so a browser page cannot call it directly. This Worker
 *   holds the key securely (as a secret, never in the page) and adds the CORS
 *   header so the EPC Lookup page can read the results.
 *
 * Setup (one-time):
 *   1. Register for a free EPC API key at:
 *        https://epc.opendatacommunities.org/  (Domestic API → register)
 *      You receive an email address + a long API token.
 *   2. Create a free Cloudflare account → Workers & Pages → Create Worker.
 *   3. Paste this file as the Worker code and Deploy.
 *   4. Add two secrets (Settings → Variables and Secrets → add secret):
 *        EPC_EMAIL = the email you registered with
 *        EPC_KEY   = the API token
 *   5. Copy the Worker URL (e.g. https://gibsons-epc.<you>.workers.dev)
 *      and paste it into the EPC Lookup page → Settings.
 *
 * Usage:  GET <worker-url>/?postcode=E11+1NS
 */
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    const postcode = (url.searchParams.get("postcode") || "").trim();
    if (!postcode) {
      return json({ error: "postcode query parameter is required" }, 400, cors);
    }

    if (!env.EPC_EMAIL || !env.EPC_KEY) {
      return json({ error: "Worker is missing EPC_EMAIL / EPC_KEY secrets" }, 500, cors);
    }

    const auth = "Basic " + btoa(`${env.EPC_EMAIL}:${env.EPC_KEY}`);
    const api =
      "https://epc.opendatacommunities.org/api/v1/domestic/search?size=100&postcode=" +
      encodeURIComponent(postcode);

    let upstream;
    try {
      upstream = await fetch(api, {
        headers: { Authorization: auth, Accept: "application/json" },
      });
    } catch (e) {
      return json({ error: "Could not reach the EPC API" }, 502, cors);
    }

    // EPC API returns 200 with JSON, or 404 when a postcode has no certificates.
    if (upstream.status === 404) {
      return json({ rows: [] }, 200, cors);
    }
    if (!upstream.ok) {
      return json({ error: "EPC API error", status: upstream.status }, upstream.status, cors);
    }

    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
    });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
