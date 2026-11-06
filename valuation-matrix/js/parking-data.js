// Parking adjustment reference (qualitative category 11, Parking) for the Gibsons tool.
// Source: docs-parking-reference.md. Values are the typical premium for one parking space, in £.
//
// Contract notes / assumptions:
// - PARKING_AREAS rows follow ARCHITECTURE.md: { key, label, region, low, high, notes }.
//   Each row also carries `cpz` (true where on street parking is normally tightly controlled),
//   used only as the default for the permit rule. The surveyor can change it in the helper.
// - Labels and notes are written without dashes or hyphens (house text rule), so
//   "Southend on Sea", "EC1 to EC4", "Kensington and Chelsea".
// - PARKING_RULES encodes the application notes. Each provision has a share of the space value
//   [low, high]. Garage is never valued here (it belongs to the Garage category only).
//   Where one side has no parking at all and the other has a driveway, the full premium applies
//   (application note 4). Otherwise the difference is the subject share less the comparable share.
// - suggestParking() is an extra helper export (not in the contract) used by ui-adjustments.js.

export const PARKING_AREAS = [
  // London boroughs
  { key: 'city-of-london', label: 'City of London (EC1 to EC4)', region: 'London', low: 40000, high: 60000, cpz: true, notes: 'Extremely restricted controlled parking zone; very high demand' },
  { key: 'westminster', label: 'Westminster', region: 'London', low: 35000, high: 55000, cpz: true, notes: 'Near zero on street availability' },
  { key: 'kensington-chelsea', label: 'Kensington and Chelsea', region: 'London', low: 40000, high: 60000, cpz: true, notes: 'Among the highest in the country' },
  { key: 'hammersmith-fulham', label: 'Hammersmith and Fulham', region: 'London', low: 25000, high: 40000, cpz: true, notes: 'Strong controlled parking zone pressure' },
  { key: 'wandsworth', label: 'Wandsworth', region: 'London', low: 20000, high: 35000, cpz: true, notes: 'Patchy controlled parking zone coverage; adjust by location' },
  { key: 'lambeth', label: 'Lambeth', region: 'London', low: 15000, high: 30000, cpz: true, notes: 'Variable' },
  { key: 'southwark', label: 'Southwark', region: 'London', low: 15000, high: 25000, cpz: true, notes: 'Regeneration areas higher' },
  { key: 'islington', label: 'Islington', region: 'London', low: 25000, high: 40000, cpz: true, notes: 'Very restricted parking' },
  { key: 'camden', label: 'Camden', region: 'London', low: 25000, high: 40000, cpz: true, notes: 'Tight throughout' },
  { key: 'hackney', label: 'Hackney', region: 'London', low: 15000, high: 25000, cpz: true, notes: 'Growing controlled parking zone coverage' },
  { key: 'tower-hamlets', label: 'Tower Hamlets', region: 'London', low: 15000, high: 25000, cpz: true, notes: 'Canary Wharf end higher' },
  { key: 'haringey', label: 'Haringey', region: 'London', low: 10000, high: 20000, cpz: true, notes: 'North London; variable' },
  { key: 'barnet', label: 'Barnet', region: 'London', low: 8000, high: 15000, cpz: true, notes: 'Outer North London' },
  { key: 'enfield', label: 'Enfield', region: 'London', low: 5000, high: 12000, cpz: true, notes: 'More supply available' },
  { key: 'waltham-forest', label: 'Waltham Forest', region: 'London', low: 8000, high: 15000, cpz: true, notes: '' },
  { key: 'redbridge', label: 'Redbridge', region: 'London', low: 5000, high: 10000, cpz: true, notes: '' },
  { key: 'havering', label: 'Havering', region: 'London', low: 3000, high: 8000, cpz: true, notes: '' },
  { key: 'newham', label: 'Newham', region: 'London', low: 8000, high: 15000, cpz: true, notes: 'Olympic legacy area higher' },
  { key: 'greenwich', label: 'Greenwich', region: 'London', low: 8000, high: 15000, cpz: true, notes: '' },
  { key: 'lewisham', label: 'Lewisham', region: 'London', low: 8000, high: 12000, cpz: true, notes: '' },
  { key: 'bromley', label: 'Bromley', region: 'London', low: 5000, high: 10000, cpz: true, notes: '' },
  { key: 'croydon', label: 'Croydon', region: 'London', low: 5000, high: 10000, cpz: true, notes: '' },
  { key: 'sutton', label: 'Sutton', region: 'London', low: 3000, high: 8000, cpz: true, notes: '' },
  { key: 'merton', label: 'Merton', region: 'London', low: 8000, high: 15000, cpz: true, notes: 'Wimbledon end higher' },
  { key: 'kingston', label: 'Kingston upon Thames', region: 'London', low: 8000, high: 15000, cpz: true, notes: '' },
  { key: 'richmond', label: 'Richmond upon Thames', region: 'London', low: 10000, high: 20000, cpz: true, notes: 'High demand, high values' },
  { key: 'hounslow', label: 'Hounslow', region: 'London', low: 5000, high: 10000, cpz: true, notes: '' },
  { key: 'ealing', label: 'Ealing', region: 'London', low: 8000, high: 15000, cpz: true, notes: '' },
  { key: 'brent', label: 'Brent', region: 'London', low: 8000, high: 15000, cpz: true, notes: '' },
  { key: 'harrow', label: 'Harrow', region: 'London', low: 5000, high: 10000, cpz: true, notes: '' },
  { key: 'hillingdon', label: 'Hillingdon', region: 'London', low: 3000, high: 8000, cpz: true, notes: '' },
  // Essex and Home Counties
  { key: 'chelmsford-centre', label: 'Chelmsford city centre', region: 'Essex/Home Counties', low: 3000, high: 6000, cpz: true, notes: 'City centre flats' },
  { key: 'chelmsford-suburbs', label: 'Chelmsford suburbs', region: 'Essex/Home Counties', low: 1000, high: 3000, cpz: false, notes: 'On street parking generally available' },
  { key: 'brentwood', label: 'Brentwood', region: 'Essex/Home Counties', low: 2000, high: 5000, cpz: false, notes: 'Station proximity affects value' },
  { key: 'basildon-thurrock', label: 'Basildon and Thurrock', region: 'Essex/Home Counties', low: 1000, high: 3000, cpz: false, notes: 'Lower demand' },
  { key: 'southend', label: 'Southend on Sea', region: 'Essex/Home Counties', low: 2000, high: 5000, cpz: false, notes: 'Seafront and town centre higher' },
  { key: 'epping-loughton', label: 'Epping and Loughton', region: 'Essex/Home Counties', low: 3000, high: 6000, cpz: false, notes: 'Tube access drives demand' },
  { key: 'harlow', label: 'Harlow', region: 'Essex/Home Counties', low: 1000, high: 2000, cpz: false, notes: 'Planned town; generally adequate supply' },
  { key: 'colchester', label: 'Colchester', region: 'Essex/Home Counties', low: 1500, high: 4000, cpz: false, notes: 'City centre pressure growing' },
  { key: 'braintree-witham', label: 'Braintree and Witham', region: 'Essex/Home Counties', low: 1000, high: 2500, cpz: false, notes: '' },
  { key: 'hertfordshire', label: 'Hertfordshire (general)', region: 'Essex/Home Counties', low: 3000, high: 8000, cpz: false, notes: 'St Albans and Harpenden at the top of the range' },
  { key: 'st-albans', label: 'St Albans', region: 'Essex/Home Counties', low: 5000, high: 10000, cpz: true, notes: 'High demand, commuter premium' },
];

export const PARKING_RULES = {
  // Share of the parking space value that each kind of provision is worth.
  shares: {
    driveway: { low: 0.5, high: 0.7, text: 'An off street driveway (no garage) is worth 50% to 70% of the parking space value.' },
    permit: {
      cpz: { low: 0.2, high: 0.3 },
      open: { low: 0, high: 0 },
      text: 'An on street permit bay is worth 20% to 30% of the parking space value in a restricted controlled parking zone, and is negligible where on street parking is easy.',
    },
    'on-street': { low: 0, high: 0, text: 'Unrestricted on street parking carries no premium.' },
    none: { low: 0, high: 0, text: 'No parking carries no premium.' },
  },
  // Application note 4: no parking at all against a property that has its own parking.
  fullPremium: { low: 1, high: 1, text: 'Where one property has its own parking and the other has none at all, the full parking space premium applies.' },
  garage: { text: 'A garage is adjusted under the Garage category only, so it is not counted again here.' },
  surveyorCheck: 'Where the comparable is in a materially different parking zone to the subject [SURVEYOR TO CHECK].',
};

const PROVISION_WORDS = {
  garage: 'a garage', driveway: 'a driveway', 'on-street': 'on street parking only',
  permit: 'a residents permit', none: 'no parking',
};
export function parkingWords(kind) { return PROVISION_WORDS[kind] || 'unknown parking'; }

export function findParkingArea(key) { return PARKING_AREAS.find((a) => a.key === key) || null; }

function shareOf(kind, cpz) {
  const s = PARKING_RULES.shares[kind];
  if (!s) return null;
  if (kind === 'permit') return cpz ? s.cpz : s.open;
  return { low: s.low, high: s.high };
}

/**
 * Suggest a £ parking adjustment for a comparable.
 * @returns {{ status: 'ok'|'garage'|'no-area'|'unknown', low, high, mid, shareLow, shareHigh, basis, area }}
 * Positive figures mean the comparable's parking is worse than the subject's (adjust up).
 */
export function suggestParking(subjectKind, compKind, areaKey, opts = {}) {
  const area = findParkingArea(areaKey);
  const cpz = typeof opts.cpz === 'boolean' ? opts.cpz : !!area?.cpz;
  const out = { status: 'ok', low: 0, high: 0, mid: 0, shareLow: 0, shareHigh: 0, basis: '', area, cpz };
  if (!subjectKind || !compKind) return { ...out, status: 'unknown', basis: 'Choose the parking for both properties.' };
  if (subjectKind === 'garage' || compKind === 'garage') return { ...out, status: 'garage', basis: PARKING_RULES.garage.text };
  if (!area) return { ...out, status: 'no-area', basis: 'Choose a parking area for the subject property first.' };
  let sl, sh, basis;
  const pair = [subjectKind, compKind];
  if (subjectKind === compKind) {
    sl = 0; sh = 0; basis = 'Both properties have the same parking, so no adjustment is suggested.';
  } else if (pair.includes('none') && pair.includes('driveway')) {
    sl = 1; sh = 1; basis = PARKING_RULES.fullPremium.text;
  } else {
    const a = shareOf(subjectKind, cpz), b = shareOf(compKind, cpz);
    if (!a || !b) return { ...out, status: 'unknown', basis: 'Parking type not recognised.' };
    // Interval difference: subject share less comparable share.
    sl = a.low - b.high; sh = a.high - b.low;
    if (sl > sh) [sl, sh] = [sh, sl];
    const key = subjectKind === 'driveway' || compKind === 'driveway' ? 'driveway' : 'permit';
    basis = PARKING_RULES.shares[key].text;
  }
  const r = (x) => Math.round(x * 100) / 100;
  sl = r(sl); sh = r(sh);
  // Scale the shares by the area range. When the comparable is better (negative shares) the
  // largest deduction uses the top of the area range, mirroring the positive case.
  const scale = (share) => (share >= 0 ? [area.low * share, area.high * share] : [area.high * share, area.low * share]);
  const lo = Math.round(Math.min(...scale(sl), ...scale(sh)));
  const hi = Math.round(Math.max(...scale(sl), ...scale(sh)));
  const mid = Math.round(((lo + hi) / 2) / 50) * 50;
  return { ...out, low: lo, high: hi, mid, shareLow: sl, shareHigh: sh, basis };
}
