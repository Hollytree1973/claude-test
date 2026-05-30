# Gibsons Surveyors — Marketing Website

A self-contained marketing website with an enquiry form for **Gibsons Surveyors**,
an independent firm of chartered surveyors.

## What's included

- **`index.html`** — single-page marketing site (hero, services, process, about, reviews, enquiry).
- **`styles.css`** — responsive styling (mobile-first, no framework or build step).
- **`script.js`** — mobile nav + enquiry form handling.

## Features

- Fully responsive, accessible single-page layout.
- Services showcase (RICS Levels 1–3, valuations, party wall, snagging).
- "How it works" process, about section, and client testimonials.
- **Enquiry form** with client-side validation that:
  - saves submissions to the browser's `localStorage` (key: `gibsons_enquiries`), and
  - opens a pre-filled email to `andrew@gibsons-surveyors.ltd` as a no-backend fallback.

## Running it

No build tools or dependencies required — just open `index.html` in a browser.

To serve locally (recommended, so fonts and relative paths behave):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Customising

- **Contact details / phone:** search for `01268 949 100` and `andrew@gibsons-surveyors.ltd`.
- **Services & prices:** edit the `#services` section in `index.html`.
- **Colours & fonts:** adjust the CSS custom properties under `:root` in `styles.css`.

## Connecting the form to a real inbox

The form currently stores enquiries locally and opens the visitor's email client.
To capture submissions server-side without managing a backend, point the form at a
form-handling service (e.g. Formspree, Getform, or a serverless function) by adding
a `fetch()` POST in `script.js` where `saveEnquiry()` is called.
