# Method (from the Gibsons comparable matrix skill)
## STEP 1 — IDENTIFY MATRIX TYPE

Establish which matrix variant is required:

| Variant | Use When |
|---|---|
| **Standard Sales Matrix** | Purchase/sale, mortgage, probate, IHT, CGT, matrimonial, Help to Buy, shared ownership |
| **BTL Matrix** | Buy to let — requires both capital value comparables AND rental comparables |
| **Rental-Only Matrix** | Rental assessment only (e.g. matrimonial maintenance, rental review) |

Ask if not stated. Both variants share the same core structure; BTL adds a second rental tab.

---

## STEP 2 — SUBJECT PROPERTY DATA

Capture before building the matrix:

- Full address
- Property type (detached / semi-detached / terraced / flat / maisonette / bungalow)
- Tenure (freehold / leasehold — if leasehold: unexpired term, ground rent, GR review pattern)
- Bedrooms
- Floor area — **sq ft AND sq m** (convert if only one supplied: 1 sq m = 10.764 sq ft)
- Condition (Good / Average / Below Average / Poor)
- Parking (garage / driveway / on-street / none — note borough if relevant for parking adjustment)
- EPC rating
- Garden (Yes/No — note size/aspect if known)
- Any special features or significant defects
- Valuation date

---

## STEP 3 — COMPARABLE DATA INPUT

For each comparable, capture:

| Field | Notes |
|---|---|
| Address | Full address |
| Property type | As above |
| Tenure | Freehold / leasehold (unexpired term if leasehold) |
| Bedrooms | |
| Floor area sq ft | Convert if only sq m supplied |
| Floor area sq m | Convert if only sq ft supplied |
| Sale price £ | |
| Sale date | DD/MM/YYYY |
| Distance from subject | Miles (to 2 dp) |
| Source | Rightmove SCT / Land Registry / other |
| Flags | See Stage 1 flags below |

**Auto-flag the following with [SURVEYOR TO CHECK]:**
- Sale more than 12 months before valuation date
- Sale more than 3 months before valuation date (HPI adjustment required)
- Auction, repossession, or new build
- No floor area available
- More than 0.5 miles from subject
- Significantly above or below the general range (>15% from median)
- Leasehold with unexpired term under 80 years

Accept data in any format — pasted SCT output, typed list, partial data. Prompt only for missing fields that materially affect the adjustment.

---

## STEP 4 — HPI TIME ADJUSTMENT

Apply to any comparable where sale date is more than 3 months before valuation date.

**Formula:**
> Adjusted Price = Sale Price × (HPI at Valuation Date ÷ HPI at Sale Date)

- Use ONS UK House Price Index, monthly, for the relevant local authority area
- If HPI data not available in context, flag for surveyor to apply manually and show formula cell
- Flag any adjustment greater than ±5% with [LARGE HPI ADJUSTMENT — SURVEYOR TO NOTE]
- Show HPI adjustment as a separate column: HPI Factor, HPI-Adjusted Price

---

## STEP 5 — QUANTUM ADJUSTMENT (FLOOR AREA)

Apply stepped band methodology to all comparables where floor area is available.

**Direction:** Positive % = comparable is smaller than subject (adjust upward). Negative % = comparable is larger (adjust downward).

**Band table:**

| Difference (%) | Adjustment Applied |
|---|---|
| Under 10% | 0% — note and justify |
| 10–20% | 5% |
| 20–30% | 10% |
| 30–40% | 15% |
| 40–50% | 20% |
| 50%+ | 30% cap |

Where floor area is unavailable: 0% quantum adjustment; flag [NO FLOOR AREA — QUANTUM ADJUSTMENT NOT APPLIED].

---

## STEP 6 — QUALITATIVE ADJUSTMENTS

17 confirmed adjustment categories. Apply to each comparable as appropriate.

Each adjustment: positive % or £ = comparable is inferior to subject (add value). Negative = comparable is superior (deduct value).

Toggle: % or £ per row — default to % unless a specific £ figure is clearly more appropriate (e.g. parking space with known borough value).

| # | Category | Guidance |
|---|---|---|
| 1 | Condition | Good/Average/Poor relative to subject |
| 2 | Fittings & Specification | High/standard/basic fit-out |
| 3 | Kitchen | Bespoke/fitted/basic — age |
| 4 | Gardens | Size, aspect, quality, south-facing premium |
| 5 | Outbuildings | Sheds, summer houses, workshops |
| 6 | Windows/Glazing | UPVC/timber/aluminium, age, condition |
| 7 | Aspect/Outlook | Views, green space, overlooked |
| 8 | Location/Position | Road type, noise, proximity to amenities |
| 9 | Layout/Configuration | Open plan vs cellular, flow, wasted space |
| 10 | EPC/Energy | Rating differential, heat pump, solar |
| 11 | Parking | See parking adjustment reference below |
| 12 | Garage | Integral/attached/detached — size |
| 13 | Tenure | Freehold vs leasehold; lease length differential |
| 14 | Extension Potential | Permitted development / planning potential |
| 15 | Age | New build premium / period premium |
| 16 | Property Type | Where type differs from subject (limited use) |
| 17 | Other | Any other material factor — must be named |

**Parking adjustment by London borough** — read `references/parking-adjustments.md` when a London property is involved.

**Total qualitative adjustment** = sum of all category adjustments for that comparable.

---

## STEP 7 — ADJUSTED VALUE AND RANGE

For each comparable:

> **Fully Adjusted Value** = HPI-Adjusted Price × (1 + Quantum Adj%) × (1 + Total Qualitative Adj%)

Or where £ adjustments used:

> **Fully Adjusted Value** = HPI-Adjusted Price × (1 + Quantum Adj%) + Total Qualitative £ Adj

**Range output:**
- Range Low = MIN of all fully adjusted values
- Range High = MAX of all fully adjusted values
- **Do NOT produce a weighted average or single adopted value** — valuation opinion is solely the RICS Registered Valuer's

---

## STEP 8 — OUTPUT FORMAT

### Option A — Excel File

Read `/mnt/skills/public/xlsx/SKILL.md` before building. Build using the xlsx skill.

**Sheet structure:**

- **Tab 1: Sales Matrix** — columns as per Step 3–7 above; Gibsons orange headers (#FF6600); freeze top row; auto-width columns; conditional formatting on flags
- **Tab 2: Rental Matrix** (BTL only) — identical structure but for rental comparables; rental per month and per week columns
- **Tab 3: Summary** — subject property data; range conclusion; date; valuer name

**Header row fill:** #FF6600 | **Header text:** #FFFFFF bold
**Data rows:** alternating #FFFFFF / #F9F9F9
**Flag cells:** yellow fill #FFFACD, red text #CC0000

### Option B — Conversation Table

Output as clean markdown table with all columns. Flag cells noted with [⚠️ SURVEYOR TO CHECK].

### Option C — Comparables Commentary Block

Draft formal commentary for inclusion in Red Book report. See Step 9.

Ask which format is needed if not stated. Default to Excel if building from scratch.

---

## STEP 9 — COMPARABLES COMMENTARY BLOCK

Draft formal Red Book-compliant comparables analysis section.

Structure:
1. **Opening** — number of comparables considered, search radius, date range, source (Rightmove SCT / Land Registry)
2. **Individual comparable notes** — for each: address, type, tenure, floor area, sale date, sale price, adjustments applied and rationale, adjusted value
3. **Outlier treatment** — any flagged comparables: why included/excluded, weight applied
4. **Range conclusion** — Range Low £[x] to Range High £[y] before valuation opinion
5. **Bridge to valuation opinion** — [VALUER TO COMPLETE]

Tone: formal, RICS Red Book standard. First person singular, past tense for inspections ("I inspected..."). Comparables described as "the subject property" and "comparable [n]".

---

## STEP 10 — LEASEHOLD MATRIX CONSIDERATIONS

Where subject or comparables are leasehold:

- Record unexpired term for each
- Apply tenure adjustment (category 13) where term differs materially from subject
- Short lease (<80 years): flag, apply limited weight, note marriage value threshold
- Marriage value traffic light:
  - 🟢 ≥100 years
  - 🟡 80–99 years
  - 🔴 <80 years — marriage value applies

For lease extension comparable matrices, read `references/lease-extension-matrix.md`.

---

## QUALITY CONTROLS

Before outputting:
- [ ] Subject property data complete
- [ ] All comparables flagged correctly
- [ ] HPI applied where sale >3 months
- [ ] Quantum adjustment band applied correctly
- [ ] Qualitative adjustments justified (not generic)
- [ ] Fully adjusted values calculated correctly
- [ ] Range Low and Range High stated — no single adopted value
- [ ] No valuation opinion stated
- [ ] Format confirmed (Excel / table / commentary)
- [ ] Harry's work flagged for Andrew review if applicable

---

## REFERENCE FILES
