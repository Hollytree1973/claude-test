---
name: gibsons-goreport-desk-research
description: Run Gibsons pre inspection desk research for a property and paste the results into the matching sections of the survey report in GoReport, using Claude in Chrome. Use when Andrew says things like "do the desk research for 22 The Hythe CM9 5HN", "fill GoReport with the desk research", "put the flood and planning info into the report", or "prep the report for tomorrow's survey".
---

# Gibsons desk research into GoReport

This skill drives Andrew's own Chrome browser (Claude in Chrome) to do two things:

1. Run the Gibsons Desk Research page for the property.
2. Open the matching report in GoReport and paste each block of text into the right section.

Andrew is always logged in to GoReport himself. Never ask for, type, or store his GoReport password.

## What you need from Andrew

The property number or name, and the postcode. If he gives a full address, take the number or name and postcode from it. If either is missing, ask once.

## Step 1: run the desk research

1. Open `https://hollytree1973.github.io/claude-test/desk-research/` in a new tab.
2. Type the number or name into "Property number or name" and the postcode into "Postcode", then click "Run desk research".
3. Wait until the results appear. If the status box says a source did not respond, note which one and carry on.
4. If a dropdown asks you to choose between several EPCs, pick the one whose address matches exactly. If none match, tell Andrew and stop.
5. Read each report card. Every card has a `data-goreport-section` attribute naming its section, and the text is in the box underneath. Don't rewrite the text; it's already in the Gibsons house style.

The cards are:

| Desk research card | GoReport section (RICS Home Survey Standard) |
|---|---|
| Section C: About the property | C, About the property (property description) |
| Section C: Energy efficiency | C, Energy efficiency |
| Section C: Location and local environment | C, Location and facilities / local environment |
| Section H: Issues for your legal advisers | H, Issues for your legal advisers (planning and tenure) |
| Section I: Risks | I, Risks (risks to the building and grounds) |

The right hand column is a starting assumption. Andrew's GoReport template may name things differently. The first time this skill runs, confirm the mapping with Andrew on screen, then update this table so later runs don't need to ask.

Don't copy anything from "Surveyor's notes". That part is for Andrew, not the client.

## Step 2: paste into GoReport

1. Switch to (or open) GoReport in another tab. If Andrew isn't logged in, stop and ask him to log in.
2. Find the job by searching for the postcode, then the address. If more than one job matches, list them and ask which one.
3. Open each section from the table above in turn and find the free text field.
4. If the field is empty, paste the text in.
5. If the field already has text, add the desk research text after it on a new paragraph. Never delete or overwrite anything Andrew has already written.
6. Save each section with GoReport's own save button if it has one.

## Rules

1. Never finalise, sign off, issue, send or email a report. Stop once the text is in place.
2. Never change condition ratings, fees, client details or anything outside the five sections above.
3. If a section can't be found, skip it and say so at the end rather than guessing where it goes.
4. If the desk research page shows "Possibly listed" or "Flood Zone 3", point that out to Andrew in your summary, because it may change how he approaches the inspection.

## Finish with a short summary

Tell Andrew which sections you filled, which you skipped and why, any sources that didn't respond, and the red or amber flags from the top of the desk research page. Remind him to choose the radon band on the desk research page if it says "Not checked yet", since that one needs a manual look at the UKradon map.
