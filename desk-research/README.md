# Gibsons Desk Research

A pre inspection desk research page for survey reports. Enter a property
number or name and a postcode and it pulls together, in one go:

| Check | Source |
|---|---|
| Location and local authority | postcodes.io |
| EPC rating, age band, floor area, construction, heating | EPC register (your existing key) |
| Conservation area, Article 4, tree preservation area, Green Belt, National Landscape, scheduled monument, SSSI | planning.data.gov.uk |
| Listed buildings at or within about 40 m | Historic England list, via planning.data.gov.uk |
| Flood zone (1, 2 or 3) | Environment Agency, via planning.data.gov.uk |
| Flood warning areas within 1 km | Environment Agency flood monitoring API |
| Bedrock and superficial geology, clay flag | British Geological Survey (1:625,000) |
| Previous sales, tenure, new build flag, recent sales in the postcode | HM Land Registry price paid data |

It then writes ready to paste paragraphs for the report sections (About the
property, Energy efficiency, Location and local environment, Issues for your
legal advisers, Risks). Each has its own Copy button, the text is editable
before copying, and "Copy all" grabs the lot. Report text never contains
dashes or hyphens.

Radon has no free address lookup, so there's a dropdown: check the UKradon
map and pick the band, and the report text updates.

Everything runs in the browser, so it works on an iPad and uses no Claude
tokens. All sources are free government open data.

## Setup

This reuses the Cloudflare Worker from the EPC lookup. Paste the updated
`epc-lookup/worker.js` into your existing Worker and Deploy. No new secrets
are needed; the EPC_EMAIL and EPC_KEY ones stay as they are. The page reads
the proxy URL you already saved on the EPC lookup page, as both pages live on
the same site.

## Pasting straight into GoReport

`skills/gibsons-goreport-desk-research/SKILL.md` is a Claude skill that uses
Claude in Chrome to run this page and paste each block into the matching
GoReport section, without overwriting anything already written and without
ever finalising the report. Upload it to Claude as a skill. The first run
should be supervised so the section mapping can be confirmed against your
GoReport template.

## Limits worth knowing

Designation data on planning.data.gov.uk is still being filled in by
councils, so a blank result means nothing was recorded, not that nothing
exists. The report text says so. Geology is broad scale mapping. Flood zones
ignore defences and don't cover surface water. None of this replaces the
legal adviser's local authority search.
