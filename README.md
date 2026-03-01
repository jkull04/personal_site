# Museum-Catalog Personal Site

Static portfolio site with a classical editorial visual system and restrained interaction.

- `index.html`
- `projects.html`
- `writings.html`
- `contact.html`

## Style Philosophy

- Classics first: travertine and bronze palette, inscription-like headings, measured spacing.
- Dinos second: optional bronze pixel easter egg on Home plus one copy-confirmation sprite on Contact.
- Motion restraint: no looping decorative motion after reveal.

## Stack

- Plain HTML
- Modular CSS (`css/base.css`, `css/components.css`, `css/dinos.css`)
- Minimal vanilla JS (`js/content.js`, `js/dinos.js`)
- JSON content sources in `data/`

## Project Structure

- `assets/images/headshot-square.png`: runtime portrait
- `assets/sprites/dinos-bronze.png`: recolored runtime atlas
- `assets/sprites/*-walk-atlas.png`: homepage dino walking atlases
- `assets/illustrations/runtime/hero-home-arena.png`: homepage pixel arena art
- `assets/illustrations/runtime/hero-writings-pantheon.png`: subpage monument art (used on Projects)
- `assets/illustrations/runtime/hero-projects-forum.png`: subpage monument art (used on Writings)
- `assets/illustrations/runtime/hero-contact-delphi.png`: subpage monument art (used on Contact)
- `assets/icons/*.svg`: small Roman icon set for dividers and metadata
- `assets/illustrations/*.svg`: monument vignettes for subpages
- `assets/source-art/*.png`: high-resolution working/source PNG exports
- `data/site.json`: site metadata and nav labels
- `data/works.json`: empty placeholder (projects are Substack-driven)
- `data/works-substack.json`: generated project entries from Substack
- `data/writings.json`: generated writing entries from Substack
- `data/substack.config.json`: Substack sync configuration
- `scripts/sync_substack_content.py`: build-time Substack sync script

## Monument Vignettes

Page mappings:

- Home: `assets/illustrations/runtime/hero-home-arena.png`
- Projects: `assets/illustrations/runtime/hero-writings-pantheon.png`
- Writings: `assets/illustrations/runtime/hero-projects-forum.png`
- Contact: `assets/illustrations/runtime/hero-contact-delphi.png`

## Dino Usage Policy

- Allowed: one optional reveal sequence on Home (triggered by bronze seal), one sent animation on Contact copy action.
- Disallowed: looping decorative animation on route cards, rows, or scroll.

## Content Authoring

### Update site metadata

Edit `data/site.json`:

```json
{
  "name": "Your Name",
  "tagline": "Your positioning line",
  "nav": [{ "label": "Home", "href": "./index.html" }]
}
```

### Publish from Substack (no manual JSON editing)

This site syncs content from `jameskull.substack.com` into local JSON files at build time.

Run the sync locally:

```bash
python scripts/sync_substack_content.py
```

The workflow also runs on:
- every push to `main`
- daily scheduled deploy

### Tag routing rules

Tag names are case-insensitive:

- `Projects`: excluded from Writings page and used for project card generation
- `Notes`: appears in Writings page "Notes" column
- `Essays`: appears in Writings page "Essays" column (unless `Notes` is also present)
- Untagged posts: excluded

All post tags are still displayed on rendered cards.

### Substack project post template (required for auto project cards)

For posts tagged `Projects`, include these exact `H4` headings:

- `Problem` (required)
- `Approach` (required)
- `Output` (required)

Posts missing any required section are skipped to keep the Projects layout clean.

Add optional metadata and links in a footer-style `H6` line:

- `Tools: ... | Outcome: ... | Stack: ... | Role: ... | GitHub: https://... | Demo: https://... | Video: https://... | Docs: https://...`

Rules:
- Use `|` as separator and `key: value` pairs.
- Keys are case-insensitive.
- Unknown keys are ignored.
- Parser reads the last valid `H6` metadata line.
- Link values should be full `http://` or `https://` URLs.

### Projects page behavior

- Projects are Substack-only (`data/works-substack.json`).
- Controls mirror Writings: search, topic filter, and newest/oldest sort.
- Results are scroll-clamped to two cards.
- Each Problem/Approach/Output block is line-clamped with `Read more`/`Show less`.

## Accessibility + Performance

- Keep explicit `width` and `height` on portrait images.
- Preserve keyboard accessibility and visible focus states.
- Maintain WCAG AA contrast targets.
- Respect `prefers-reduced-motion: reduce`.
- Avoid heavy libraries and large background assets.

## GitHub Pages Deployment

This repo includes `.github/workflows/deploy-pages.yml` for auto-deploy.

1. Push to GitHub on `main`.
2. Set Pages source to GitHub Actions.
3. Publish under project path:
   `https://<user>.github.io/<repo>/`

All links use relative paths for project-site compatibility.
Substack sync runs during the deploy workflow and updates generated content before artifact upload.

## Local Preview

```bash
python -m http.server 8080
```

Open `http://localhost:8080/index.html`.

## Dino Atlas Maintenance

Source files:

- `assets/source-art/final-steg.png`
- `assets/source-art/final-raptor.png`
- `assets/source-art/final-longneck.png`

Normalize all dino walk atlases and validate geometry plus runtime slicing:

```bash
python scripts/normalize_longneck_atlas.py
python scripts/validate_sprite_atlas.py --atlas assets/sprites/stegosaurus-walk-atlas.png
python scripts/validate_sprite_atlas.py --atlas assets/sprites/raptor-walk-atlas.png
python scripts/validate_sprite_atlas.py --atlas assets/sprites/marble-brach-walk-atlas.png
```

The normalizer auto-detects per-frame boundaries from each final source sheet, removes disconnected artifacts, and emits anchored 8x1 runtime atlases.
