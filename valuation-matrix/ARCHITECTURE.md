# Gibsons Valuation Comparison Tool: architecture contract

Static, no build step, served by GitHub Pages at `/valuation-matrix/`. Vanilla ES modules
(`<script type="module">`). Works offline except for optional CDN libraries and the optional
HPI fetch. Must work on iPad Safari and desktop Chrome. British English throughout.

Brand: Gibsons orange `#FF6600` (headers, accents), dark grey `#333333` text, white rows,
alternate rows `#F9F9F9`, flag cells yellow `#FFFACD` with red text `#CC0000`.

Methodology source: the Gibsons comparable matrix skill (summarised in METHOD.md). The tool
NEVER produces a single adopted value or weighted average. It outputs Range Low and Range High
only; valuation opinion is the RICS Registered Valuer's.

## Files and owners

| File | Owner | Purpose |
|---|---|---|
| js/store.js | (given) | tiny reactive store, do not change the API |
| js/model.js | (given) | state factory, comparable factory, CATEGORIES, constants |
| js/calc.js | calc agent | pure maths: HPI, quantum bands, qualitative, adjusted value, flags, range |
| js/parsers.js | parsers agent | paste/CSV import of comparables |
| js/hpi.js + js/ui-hpi.js | hpi agent | UK HPI data fetch/paste and the HPI panel |
| js/export-xlsx.js | xlsx agent | branded Excel workbook export |
| js/commentary.js | commentary agent | Red Book commentary text + markdown table |
| js/ui-subject.js | subject UI agent | case details + subject property form |
| js/ui-comparables.js | comparables UI agent | comparables entry (sales + rentals) and paste import dialog |
| js/ui-adjustments.js + js/parking-data.js | adjustments UI agent | 17 category adjustment grid, parking helper |
| js/ui-results.js | results UI agent | results matrix, range chart, exports, save/load case |
| js/app.js, index.html, css/base.css | integrator | wiring, layout, tabs, README |

Each UI module may add its own stylesheet `css/<module>.css` (e.g. `css/ui-subject.css`);
scope selectors under the module root class (e.g. `.vm-subject ...`). Use the CSS custom
properties from `css/base.css`; do not redefine them.

## Store API (js/store.js)

```js
import { store } from './store.js';
store.get()                 // current state object (treat as read only)
store.update(fn)            // fn(draft) mutates a structuredClone of state; then notifies
store.subscribe(fn)         // fn(state, evaluation) on every change; returns unsubscribe
store.evaluation()          // latest calc.evaluate(state) result (recomputed on each update)
store.replace(newState)     // load a whole case
```
Store persists to localStorage key `gibsons-vm-case` (wrapped in try/catch).

## UI module contract

Every `ui-*.js` exports `mount(rootEl, store)`. It renders into rootEl, subscribes to the store,
and re-renders what changed. Avoid destroying a focused input while the user types (update
values in place or re-render only on structural changes). Mount points in index.html:

```
#vm-subject      ui-subject.js
#vm-hpi          ui-hpi.js
#vm-comparables  ui-comparables.js
#vm-adjustments  ui-adjustments.js
#vm-results      ui-results.js
```

## State shape (see js/model.js for factories and defaults)

```js
state = {
  version: 1,
  caseRef: '', valuer: 'Andrew Gibson MRICS', valuationDate: 'YYYY-MM-DD',
  instructionType: 'mortgage' | 'purchase' | 'probate' | 'iht' | 'cgt' | 'matrimonial' |
                   'help-to-buy' | 'shared-ownership' | 'btl' | 'rental' | 'other',
  matrixType: 'sales' | 'btl' | 'rental',   // btl = sales + rentals; rental = rentals only
  subject: {
    address, postcode, propertyType,         // 'detached'|'semi-detached'|'terraced'|'end-terrace'|'flat'|'maisonette'|'bungalow'
    tenure: 'freehold'|'leasehold', unexpiredTerm: number|null, groundRent: number|null, groundRentReview: '',
    bedrooms: number|null, floorAreaSqFt: number|null, floorAreaSqM: number|null,
    condition: 'good'|'average'|'below-average'|'poor',
    parking: 'garage'|'driveway'|'on-street'|'permit'|'none', parkingArea: '',  // parkingArea = key in parking-data.js
    epc: 'A'..'G'|'', garden: true|false, gardenNotes: '', features: '', defects: ''
  },
  hpi: {
    regionSlug: '', regionLabel: '',          // e.g. 'chelmsford', 'Chelmsford'
    series: [{ month: 'YYYY-MM', index: number }],  // optional cached monthly series
    valuationIndex: number|null,              // index at valuation date (manual override wins)
    source: ''                                // e.g. 'HM Land Registry UK HPI, fetched 2026-11-06'
  },
  sales:   [Comparable],
  rentals: [Comparable]
}

Comparable = {
  id: string,                 // model.newId()
  address, postcode, propertyType, tenure, unexpiredTerm: number|null, bedrooms: number|null,
  floorAreaSqFt: number|null, floorAreaSqM: number|null,
  price: number|null,         // sale price £; for rentals = rent £ per calendar month
  saleDate: 'YYYY-MM-DD'|'', // for rentals = date let / listed
  distanceMiles: number|null,
  source: '',                 // 'Rightmove SCT' | 'Land Registry' | 'Agent' | other
  saleKind: 'standard'|'auction'|'repossession'|'new-build',
  hpiAtSale: number|null,     // index for sale month (filled by hpi.js or by hand)
  quantumOverride: number|null, // % override of the band result, null = use band
  adjustments: { [categoryKey]: { mode: 'pct'|'gbp', value: number, note: string } },
  excluded: false,            // excluded from range but still shown
  notes: ''
}
```
Percentages are stored as human percentages (5 means 5%). Money is plain numbers in pounds.

## calc.js API (pure, no DOM; must run under Node for tests)

```js
export function sqftToSqm(x)  // 1 sq m = 10.764 sq ft, round 1 dp
export function sqmToSqft(x)
export function monthsBetween(isoA, isoB)      // whole + fractional months, B minus A
export function quantum(subjectSqFt, compSqFt) // -> { diffPct, bandPct, adjPct, applied, flag }
   // diffPct = (subject - comp) / subject * 100 (signed; positive when comp is smaller)
   // band on |diffPct|: <10 -> 0, 10<=d<20 -> 5, 20<=d<30 -> 10, 30<=d<40 -> 15, 40<=d<50 -> 20, >=50 -> 30 (cap)
   // adjPct = sign(diffPct) * band. Missing area -> adjPct 0, applied false, flag 'NO_FLOOR_AREA'
export function hpi(comp, state)  // -> { required, factor, adjustedPrice, applied, flag }
   // required when sale more than 3 months before valuationDate.
   // factor = state.hpi.valuationIndex / comp.hpiAtSale. Missing indices when required ->
   // factor null, adjustedPrice = price, flag 'HPI_MISSING'. |factor-1| > 5% -> flag 'LARGE_HPI'.
   // Rentals: never apply HPI (required false).
export function qualitative(comp) // -> { pct, gbp, rows:[{key,label,mode,value,note}] }
export function adjustedValue(comp, state) // HPI-adjusted x (1+quantum%) x (1+qual%) + qual£
export function flagsFor(comp, state, ctx)  // ctx = { median } of HPI-adjusted prices of included comps
   // returns [{ code, label, severity: 'warn'|'info' }]. Codes:
   // OVER_12_MONTHS, HPI_REQUIRED (sale >3 months), HPI_MISSING, LARGE_HPI, AUCTION, REPOSSESSION,
   // NEW_BUILD, NO_FLOOR_AREA, OVER_HALF_MILE (>0.5 miles), OUTLIER (>15% from median),
   // SHORT_LEASE (leasehold <80 years), MISSING_PRICE, MISSING_DATE
export function leaseLight(years) // 'green' (>=100) | 'amber' (80 to 99) | 'red' (<80) | null
export function evaluate(state)   // -> {
   //   sales:   [Result], rentals: [Result],
   //   salesRange:  { low, high, count, median, lowPerSqFt, highPerSqFt },
   //   rentalRange: { low, high, count, median, lowWeekly, highWeekly },
   //   subjectSqFt, warnings: [string]
   // }
   // Result = { id, index (1 based), hpi, quantum, qual, adjustedValue, perSqFt,
   //            weekly (rentals: pcm*12/52), flags, included, leaseLight }
   // Range ignores excluded comps and comps with no adjustedValue. No average/adopted value.
export const FLAG_LABELS  // code -> human label, e.g. 'Sale over 12 months old [SURVEYOR TO CHECK]'
```

## Other module APIs

```js
// parsers.js
export function parseComparables(text, { kind: 'sales'|'rentals' }) // -> { rows: Partial<Comparable>[], warnings: string[], format }
// hpi.js
export const REGIONS              // [{ slug, label, group }] Essex districts, London boroughs, Herts districts, England, UK
export async function fetchSeries(slug, fromMonth, toMonth) // -> [{month, index}] or throws Error with friendly message
export function parseSeriesCsv(text)  // pasted 'month,index' or ONS/Land Registry CSV -> [{month,index}]
export function indexFor(series, isoDate) // nearest month at or before; null if none
export function applySeries(state, series) // mutates a draft: fills hpi.valuationIndex + each sales comp hpiAtSale (only where null unless force)
// export-xlsx.js
export async function exportXlsx(state, evaluation) // triggers download 'Gibsons comparable matrix <caseRef or address> <date>.xlsx'
// commentary.js
export function buildCommentary(state, evaluation) // -> plain text Red Book comparables commentary
export function buildMarkdownTable(state, evaluation, kind = 'sales') // -> markdown string
// parking-data.js
export const PARKING_AREAS // [{ key, label, region: 'London'|'Essex/Home Counties', low, high, notes }]
export const PARKING_RULES // multipliers: driveway 0.5 to 0.7, permit 0.2 to 0.3 in CPZ, etc.
```

## Text rules for anything the tool writes

British English. No dashes or hyphens in generated prose (write "1 to 3", not "1-3"). Plain
words a member of the public can follow. Flags use the house style `[SURVEYOR TO CHECK]`.
