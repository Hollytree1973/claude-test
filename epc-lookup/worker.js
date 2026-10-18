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
 *
 * Desk research routes (used by /desk-research/, no extra secrets needed):
 *   ?src=postcode&postcode=CM9+5HN     postcodes.io (location, council)
 *   ?src=planning&lat=..&lon=..        planning.data.gov.uk designations
 *   ?src=listed&lat=..&lon=..          listed buildings within about 40 m
 *   ?src=floodareas&lat=..&lon=..      Environment Agency flood warning areas
 *   ?src=geology&lat=..&lon=..         BGS bedrock and superficial geology
 *   ?src=pricepaid&postcode=CM9+5HN    HM Land Registry price paid data
 * Each route calls one fixed government API, so this is not an open proxy.
 */
const PLANNING_DATASETS = [
  "conservation-area",
  "listed-building-outline",
  "article-4-direction-area",
  "tree-preservation-zone",
  "flood-risk-zone",
  "green-belt",
  "area-of-outstanding-natural-beauty",
  "scheduled-monument",
  "site-of-special-scientific-interest",
];

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
    const src = url.searchParams.get("src");
    if (src) {
      return deskResearch(src, url.searchParams, cors);
    }

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

async function deskResearch(src, params, cors) {
  // Land Registry stores postcodes as "CM9 5HN", so normalise whatever was typed.
  const compact = (params.get("postcode") || "").toUpperCase().replace(/\s+/g, "");
  const postcode = compact.length > 3 ? compact.slice(0, -3) + " " + compact.slice(-3) : compact;
  const lat = parseFloat(params.get("lat"));
  const lon = parseFloat(params.get("lon"));
  const needsPoint = ["planning", "listed", "floodareas", "geology"].includes(src);
  if (needsPoint && (!isFinite(lat) || !isFinite(lon))) {
    return json({ error: "lat and lon are required" }, 400, cors);
  }

  let api;
  switch (src) {
    case "postcode":
      api = "https://api.postcodes.io/postcodes/" + encodeURIComponent(postcode);
      break;
    case "planning":
      api =
        "https://www.planning.data.gov.uk/entity.json?exclude_field=geometry&limit=100" +
        `&latitude=${lat}&longitude=${lon}` +
        PLANNING_DATASETS.map((d) => "&dataset=" + d).join("");
      break;
    case "listed": {
      // Roughly 40 m each way: listed buildings are stored as points, not outlines.
      const dLat = 0.00036, dLon = 0.00058;
      const poly = `POLYGON((${lon - dLon} ${lat - dLat},${lon + dLon} ${lat - dLat},${lon + dLon} ${lat + dLat},${lon - dLon} ${lat + dLat},${lon - dLon} ${lat - dLat}))`;
      api =
        "https://www.planning.data.gov.uk/entity.json?dataset=listed-building&geometry_relation=intersects" +
        "&exclude_field=geometry&limit=30&geometry=" + encodeURIComponent(poly);
      break;
    }
    case "floodareas":
      api = `https://environment.data.gov.uk/flood-monitoring/id/floodAreas?lat=${lat}&long=${lon}&dist=1`;
      break;
    case "geology": {
      const bbox = `${lon},${lat},${lon + 0.0001},${lat + 0.0001}`;
      const base = "https://ogcapi.bgs.ac.uk/collections/";
      const q = `/items?f=json&skipGeometry=true&limit=5&bbox=${bbox}`;
      const [bedrock, superficial] = await Promise.all([
        getJson(base + "bgsgeology625kbedrock" + q),
        getJson(base + "bgsgeology625ksuperficial" + q),
      ]);
      return json({ bedrock, superficial }, 200, cors);
    }
    case "pricepaid": {
      if (!/^[A-Z0-9 ]{5,8}$/.test(postcode)) {
        return json({ error: "valid postcode is required" }, 400, cors);
      }
      const query = `PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT ?paon ?saon ?street ?amount ?date ?ptype ?estate ?newbuild WHERE {
  ?addr lrcommon:postcode "${postcode}" .
  ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ;
      lrppi:propertyType ?ptype ; lrppi:estateType ?estate ; lrppi:newBuild ?newbuild .
  OPTIONAL { ?addr lrcommon:paon ?paon } OPTIONAL { ?addr lrcommon:saon ?saon }
  OPTIONAL { ?addr lrcommon:street ?street }
} ORDER BY DESC(?date) LIMIT 200`;
      api = "https://landregistry.data.gov.uk/landregistry/query?output=json&query=" + encodeURIComponent(query);
      break;
    }
    default:
      return json({ error: "unknown src" }, 400, cors);
  }

  const data = await getJson(api);
  return json(data, data && data.error ? 502 : 200, cors);
}

async function getJson(api) {
  try {
    const r = await fetch(api, { headers: { Accept: "application/json" } });
    if (r.status === 404) return { notFound: true };
    if (!r.ok) return { error: "upstream error", status: r.status };
    return await r.json();
  } catch (e) {
    return { error: "could not reach upstream" };
  }
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
