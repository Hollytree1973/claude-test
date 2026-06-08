# HLG Veterinary Physiotherapy — Website

A fast, responsive, single-page website for **HLG Veterinary Physiotherapy** —
Holly Gibson, a Masters qualified, RAMP registered mobile veterinary
physiotherapist providing evidence-based, compassionate care for dogs and
horses across Essex.

## Services featured
- 🐾 **Canine Physiotherapy**
- 🐴 **Equine Physiotherapy**
- 🦷 **Ultrasound Dog Teeth Cleaning** (Emmi-Pet, no anaesthetic)
- Loyalty card & referral rewards, transparent pricing, mobile travel info

## Tech
Plain HTML, CSS and JavaScript — no build step or dependencies. Ready to host
anywhere static (e.g. GitHub Pages, Netlify).

```
index.html      # page content & structure
styles.css      # brand styling (green / amber / charcoal)
script.js       # mobile nav + scroll reveal
assets/logo.svg # brand emblem (horseshoe + wolf + paw)
```

## Running locally
Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Things to customise
- **Logo** — `assets/logo.svg` is a placeholder emblem inspired by the brand.
  Drop in the real HLG logo image and update the `<img src>` references.
- **Photos** — add real photos of Holly and treatments to the About/Services
  sections for a more personal feel.
- **Contact form** — currently posts via [FormSubmit](https://formsubmit.co)
  to `holly@gibsons.ltd.uk`. The first submission triggers a one-time email to
  confirm the address. Swap for any other form handler if preferred.
- **Social links** — update the Facebook URL to the exact page link.
