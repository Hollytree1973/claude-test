# Gibsons Comparable Matrix

A comparable evidence matrix for residential valuations by Gibsons Surveyors. You enter the subject property and your comparables, the tool adjusts each comparable for time, size and the differences you set, and it shows the range the adjusted evidence supports as a **Range Low** and a **Range High**.

The tool never produces a single adopted value, an average or a weighted average. The valuation opinion is always yours as the RICS Registered Valuer.

It runs in a web browser on an iPad or a desktop computer. There is nothing to install.

## Using it day to day

1. **Case and subject.** Enter the case reference, valuation date and instruction type, then the subject property: address, type, tenure (with the unexpired term if leasehold), bedrooms, floor area in either sq ft or sq m (the other fills itself in), condition, parking, EPC and garden. The green bar at the top tells you when everything the matrix needs is filled in. Choosing Buy to let or Rental assessment switches the matrix to include rents.
2. **Comparables.** Add each sale with **Add comparable**, or use **Import from paste** to paste text copied from Rightmove, a Land Registry price paid download, a spreadsheet table or a typed list. You will see a preview with any points to check before anything is added. Untick **Include in range** to keep a comparable on the sheet but leave it out of the range.
3. **HPI.** Pick the local authority area and press **Fetch index figures**. If the fetch does not work, open the HM Land Registry page from the link, copy the figures and paste them instead. The tool fills in the index at the valuation date and at each sale date. You can type any figure by hand.
4. **Adjustments.** For each comparable, set an adjustment against any of the 17 categories as a percentage or a pound figure, with a short reason. The size adjustment is worked out for you and can be overridden. The parking helper suggests a figure from the Gibsons parking reference for the area.
5. **Results.** Check the Range Low and Range High, the chart, the full matrix and the list of points to check. Every item marked [SURVEYOR TO CHECK] needs your judgement.
6. **Export.** Download the Excel workbook, copy the Red Book commentary into your report, and save the case file for the job folder.

New to the tool? Press **Load example case** on the first step to see a complete worked case.

## How the adjustments work

Each comparable is brought into line with the subject in three stages.

**Time (HPI).** Any sale more than 3 months before the valuation date is adjusted by the UK House Price Index:
adjusted price = sale price × (index at valuation date ÷ index at sale date).
A change of more than 5% is flagged for you to note.

**Size (quantum).** The difference in floor area between the subject and the comparable sets a band:

| Size difference | Adjustment |
|---|---|
| under 10% | none |
| 10% to under 20% | 5% |
| 20% to under 30% | 10% |
| 30% to under 40% | 15% |
| 40% to under 50% | 20% |
| 50% or more | 30% (the cap) |

A smaller comparable is adjusted up and a larger one down. You can override the band for any comparable.

**Qualitative.** Your adjustments for condition, kitchen, garden, location, parking and the other categories. A positive figure means the comparable is worse than the subject, so its price goes up; a negative figure means it is better, so its price comes down. Percentages are added together and applied after the size adjustment, then pound adjustments are added.

**The range.** Range Low is the lowest fully adjusted value and Range High is the highest, using only the comparables you have included. Nothing is averaged. The figures per sq ft are shown alongside.

**Flags.** The tool marks with [SURVEYOR TO CHECK] any sale over 12 months old, sales needing HPI or missing an index, large HPI changes, auction, repossession and new build sales, comparables with no floor area, more than half a mile away, more than 15% away from the middle of the evidence, or leasehold under 80 years.

## HPI options

1. **Fetch** the official monthly figures for the area from HM Land Registry (this needs an internet connection).
2. **Paste** figures copied from the HM Land Registry or ONS website, or from a spreadsheet. Lines such as "Mar 2026, 152.3" work too.
3. **Type** the index at the valuation date and at each sale by hand.

The tool uses the nearest month at or before each date, and tells you which month it used. HPI figures are published about two months behind, so the latest month may be earlier than the valuation date. Note the source line, which goes into the workbook and the commentary.

## Exports

1. **Download Excel.** A branded workbook with the matrix, an adjustments sheet and a summary. The HPI factor, adjusted prices, totals and the range are live formulas, so you can change an adjustment in Excel and see the effect. The first time you export, the tool loads the Excel library from the internet.
2. **Copy Red Book commentary.** Plain text covering the evidence, each comparable and its adjustments, outlier treatment and the range, ending with a placeholder for your valuation opinion. Read it through and complete the parts marked [VALUER TO COMPLETE] and [VALUER TO ADD RATIONALE].
3. **Copy markdown table.** The matrix as a table you can paste into other documents.
4. **Print.** The summary and matrix on A4 landscape.
5. **Save case and Open case.** A small file holding the whole case, to keep with the job or to move to another device.

## Where your data is kept

Everything you enter stays in this browser on this device. It is saved automatically as you type, so closing the page does not lose your work. Nothing is sent anywhere except the HPI fetch, which only asks HM Land Registry for index figures. To keep a case safely, or to open it on another device, use **Save case**. Clearing the browser's data, or using a private window, removes the saved case. The tool holds one open case at a time; **New case** and **Load example case** replace it, so save first.

## Known limits

1. The HPI fetch depends on HM Land Registry allowing the request from a web page. If it does not work on your device, use the paste route.
2. Importing from pasted Rightmove text relies on the usual layout. Unusual text may split or merge properties wrongly, so always check the preview.
3. Land Registry data has no floor areas or bedrooms; add them by hand.
4. The commentary tidies your own wording to keep to the house style (for example dates written out in words, and number ranges written as "10 to 12"). Check it reads as you intend.
5. There is no inspection date field, so the commentary uses the valuation date.
6. In the Excel file, the size difference and size adjustment are fixed figures rather than formulas.
7. The lease extension reference (docs-lease-reference.md) is not yet built into the tool.
8. It has been tested in Chrome at iPhone and iPad sizes. It has not been tested on a real iPad with Safari.

## For whoever maintains it

Plain HTML, CSS and JavaScript with no build step. Serve the folder and open index.html. Tests:

```
node --test tests/
node tests/e2e.mjs
```

ARCHITECTURE.md describes how the files fit together and METHOD.md sets out the method.
