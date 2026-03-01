# Museum-Catalog Personal Site

Static personal website with a classical editorial visual language, Substack-synced content, and lightweight vanilla JS interactions.

## Table Of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Routes And Pages](#routes-and-pages)
- [Repository Layout](#repository-layout)
- [Data Model](#data-model)
- [Substack Content Pipeline](#substack-content-pipeline)
- [Front-End Runtime Behavior](#front-end-runtime-behavior)
- [Local Development](#local-development)
- [Maintenance Scripts](#maintenance-scripts)
- [Deployment](#deployment)
- [Substack Sync Verification Workflow](#substack-sync-verification-workflow)
- [Accessibility And Performance](#accessibility-and-performance)
- [Troubleshooting](#troubleshooting)

## Overview

The site is a static HTML/CSS/JS project that renders:

- Home (`/`) with an interactive arena scene and route navigation.
- Projects (`/projects/`) from Substack-derived project entries.
- Writings (`/writings/`) split into Essays and Notes columns.
- Contact (`/contact/`) with copy-email interaction, resume download, and socials.

All content hydration is client-side from JSON files in `data/`.

## Architecture

- Markup: plain HTML pages (`index.html`, `projects/index.html`, `writings/index.html`, `contact/index.html`).
- Styles: modular CSS files:
  - `css/base.css` for tokens, typography, resets, global utilities.
  - `css/components.css` for layout/components/page sections.
  - `css/dinos.css` for sprite animation and dino-specific states.
- Runtime JS:
  - `js/content.js` loads JSON, renders listings, wires filtering/sorting/clamping.
  - `js/dinos.js` handles dino interactions, arena roaming, tooltips, and email copy feedback.
- Content sources:
  - `data/site.json` for site-level text (name/tagline/nav labels).
  - `data/writings.json` generated from Substack.
  - `data/works-substack.json` generated from Substack.
  - `data/works.json` is a placeholder and currently unused by runtime rendering.

## Routes And Pages

Canonical routes use trailing slashes:

- `/` -> `index.html`
- `/projects/` -> `projects/index.html`
- `/writings/` -> `writings/index.html`
- `/contact/` -> `contact/index.html`

Compatibility redirect shims are maintained:

- `projects.html` redirects to `/projects/`
- `writings.html` redirects to `/writings/`
- `contact.html` redirects to `/contact/`

Additional pages:

- `404.html` custom not-found page.
- `CNAME` is set to `www.jameskull.com`.
- `.nojekyll` is included for GitHub Pages static serving behavior.

## Repository Layout

High-signal files and folders:

- `.github/workflows/deploy-pages.yml`: GitHub Pages deploy workflow.
- `assets/illustrations/runtime/*.png`: runtime hero monument art.
- `assets/sprites/*-walk-atlas.png`: dino walk atlases used at runtime.
- `assets/source-art/*.png`: source sprite sheets for atlas normalization.
- `assets/images/headshot-square.png`: profile image.
- `assets/documents/James F Kull Jr. Resume.pdf`: downloadable resume.
- `assets/icons/*.svg` and `assets/icons/laurel-circle.png`: icon set and favicon source.
- `css/`: styling system.
- `js/`: runtime logic.
- `data/`: JSON inputs for rendered content.
- `scripts/sync_substack_content.py`: Substack sync generator.
- `scripts/normalize_longneck_atlas.py`: sprite atlas normalizer (all dinos).
- `scripts/validate_sprite_atlas.py`: sprite atlas validator.
- `style.md`: visual direction, palette, and pixel-art constraints.

## Data Model

### `data/site.json`

Used to hydrate:

- `[data-site-name]`
- `[data-site-tagline]`

Expected shape:

```json
{
  "name": "James Kull",
  "tagline": "Making things.",
  "nav": [
    { "label": "Home", "href": "/" },
    { "label": "Projects", "href": "/projects/" },
    { "label": "Writings", "href": "/writings/" },
    { "label": "Contact", "href": "/contact/" }
  ]
}
```

### `data/writings.json`

Expected entry shape:

```json
{
  "id": "slug-like-id",
  "type": "essay",
  "title": "Entry Title",
  "date": "YYYY-MM-DD",
  "tags": ["Essays"],
  "abstract": "Short summary text",
  "href": "https://...substack.com/p/..."
}
```

`type` values used by runtime:

- `essay` -> Essays column
- `blog` -> Notes column

### `data/works-substack.json`

Expected entry shape:

```json
{
  "id": "slug-like-id",
  "title": "Project Title",
  "date": "YYYY-MM-DD",
  "summary": "Short summary",
  "tags": ["Projects"],
  "year": "2026",
  "tools": "Substack",
  "outcome": "Outcome text",
  "metadata": {
    "tools": "Substack",
    "outcome": "Outcome text",
    "stack": "Optional",
    "role": "Optional"
  },
  "problem": "Required section text",
  "approach": "Required section text",
  "output": "Required section text",
  "links": [
    { "label": "Project Post", "href": "https://..." },
    { "label": "GitHub", "href": "https://..." }
  ]
}
```

## Substack Content Pipeline

Script: `python scripts/sync_substack_content.py`

Config file: `data/substack.config.json`

Current configured host:

- `publication_host`: `jameskull.substack.com`

Generated outputs:

- `data/writings.json`
- `data/works-substack.json`

### Tag Routing Rules

Tag matching is case-insensitive:

- `Projects`: treated as project entries and excluded from Writings list.
- `Notes`: emitted as writings `type = "blog"`.
- `Essays`: emitted as writings `type = "essay"` if not classified as Notes.
- Untagged or unmatched posts are skipped.

Only public posts (`audience == "everyone"` and published) are included.

### Required Project Post Template

For Substack posts tagged `Projects`, include these exact `H4` headings:

- `Problem`
- `Approach`
- `Output`

If any required `H4` section is missing, the post is skipped.

### Optional Project Metadata (`H6`)

Use a footer-style `H6` line with pipe-delimited `key: value` tokens. Example:

```text
Tools: ... | Outcome: ... | Stack: ... | Role: ... | GitHub: https://... | Demo: https://... | Video: https://... | Docs: https://... | Slides: https://...
```

Rules:

- Parser reads the last valid `H6` metadata line in the post body.
- Supported keys: `tools`, `outcome`, `stack`, `role`, `github`, `demo`, `video`, `docs`, `slides`.
- Unknown keys are ignored.
- URL values must begin with `http://` or `https://` to be emitted.

### Reliability Behavior

`sync_substack_content.py` writes JSON atomically and only replaces output files after full payload generation, preserving last-good data on partial failures.

## Front-End Runtime Behavior

### `js/content.js`

- Loads only the JSON files needed by the current page (`site.json`, `works-substack.json`, `writings.json`) via `fetch`.
- Hydrates site name/tagline text.
- Renders Projects cards with:
  - Search by title/summary/sections/tags/metadata fields.
  - Topic filter from unique tags.
  - Newest/oldest sort by date.
  - Section text clamping with per-block `Read more`/`Show less`.
  - Scroll clamp to 2 visible project cards.
- Renders Writings columns with:
  - Search by title/abstract/tags.
  - Topic filter from unique tags.
  - Newest/oldest sort by date.
  - Scroll clamp to 3 visible cards per column.

### `js/dinos.js`

- Initializes dino display variants and reduced-motion behavior.
- Binds copy-email interactions for any `[data-copy-email]` button.
- Home page arena roamers:
  - Compute movement bounds from `.arena-colosseum` geometry and CSS variables.
  - Roam with randomized targets, separation force, and edge bias.
  - Set facing direction from velocity and maintain depth ordering.
  - Show tooltips and rotate small tooltip messages on repeated interactions.

## Local Development

### Prerequisites

- Python 3.10+ recommended.
- No Node tooling required.
- For sprite/image helper scripts: `Pillow` and `numpy`.

Install optional script dependencies:

```bash
python -m pip install pillow numpy
```

### Run Local Server

```bash
python -m http.server 8080
```

Open:

- `http://localhost:8080/`

Important:

- Do not open with `file://`; JSON fetches and route behavior require HTTP serving.

## Maintenance Scripts

### 1) Sync Substack content

```bash
python scripts/sync_substack_content.py
```

Writes:

- `data/writings.json`
- `data/works-substack.json`

### 2) Normalize sprite atlases

```bash
python scripts/normalize_longneck_atlas.py --sprite all
```

Target options:

- `all`
- `stego`
- `raptor`
- `longneck`

Outputs:

- `assets/sprites/stegosaurus-walk-atlas.png`
- `assets/sprites/raptor-walk-atlas.png`
- `assets/sprites/marble-brach-walk-atlas.png`

### 3) Validate sprite atlases

```bash
python scripts/validate_sprite_atlas.py --atlas assets/sprites/stegosaurus-walk-atlas.png
python scripts/validate_sprite_atlas.py --atlas assets/sprites/raptor-walk-atlas.png
python scripts/validate_sprite_atlas.py --atlas assets/sprites/marble-brach-walk-atlas.png
```

Useful options:

- `--display-size WIDTHxHEIGHT` (repeatable)
- `--skip-display-checks`
- `--require-style-marble-palette`

### 4) Optimize runtime image assets

```bash
python scripts/optimize_runtime_images.py
python scripts/optimize_runtime_images.py --check
```

Expected outputs:

- `assets/illustrations/runtime/hero-home-arena-960.webp`
- `assets/illustrations/runtime/hero-home-arena-1536.webp`
- `assets/illustrations/runtime/hero-projects-forum-960.webp`
- `assets/illustrations/runtime/hero-projects-forum-1536.webp`
- `assets/illustrations/runtime/hero-writings-pantheon-960.webp`
- `assets/illustrations/runtime/hero-writings-pantheon-1536.webp`
- `assets/illustrations/runtime/hero-contact-delphi-960.webp`
- `assets/illustrations/runtime/hero-contact-delphi-1536.webp`
- `assets/sprites/stegosaurus-walk-atlas-2x.webp`
- `assets/sprites/raptor-walk-atlas-2x.webp`
- `assets/sprites/marble-brach-walk-atlas-2x.webp`
- `assets/images/headshot-square-640.webp`
- `assets/icons/favicon-32.png`

Re-run this script whenever runtime PNG sources are replaced or re-exported.

## Deployment

Workflow file: `.github/workflows/deploy-pages.yml`

Triggers:

- Push to `main`
- Scheduled run every 6 hours at `:17` (`00:17`, `06:17`, `12:17`, `18:17` UTC)
- Manual `workflow_dispatch`

Pipeline steps:

1. Checkout repository.
2. Setup Python 3.13.
3. Install Pillow (`python -m pip install --upgrade pip pillow`).
4. Run `python scripts/sync_substack_content.py --diagnostics --retries 6 --timeout 30`.
5. Run `python scripts/optimize_runtime_images.py --check`.
6. Configure Pages.
7. Upload full repository artifact.
8. Deploy to GitHub Pages.

## Substack Sync Verification Workflow

Workflow file: `.github/workflows/verify-substack-sync.yml`

Purpose:

- Run Substack sync health checks on a schedule without doing a Pages deploy.
- Fail fast when API/request issues occur, with structured diagnostics in logs and step summary.

Triggers:

- Scheduled run every 6 hours at `:27` (`00:27`, `06:27`, `12:27`, `18:27` UTC)
- Manual `workflow_dispatch`

Verification steps:

1. Checkout repository.
2. Setup Python 3.13.
3. Run `python scripts/sync_substack_content.py --diagnostics --retries 6 --timeout 30`.

Notes:

- Because pages and assets use root-absolute paths (for example `/css/base.css`), deployment is intended for a custom domain root (current `CNAME`: `www.jameskull.com`).
- If deploying under a repository subpath such as `https://<user>.github.io/<repo>/`, root-absolute links will need base-path adjustments.

## Accessibility And Performance

Current implementation includes:

- Skip link to `#main`.
- Visible focus states for keyboard navigation.
- `prefers-reduced-motion` handling in global CSS and dino CSS/JS.
- Explicit intrinsic dimensions on key portrait images.
- Lightweight runtime stack with no heavy framework dependency.

Maintenance expectations:

- Keep contrast at WCAG AA minimum for text/UI.
- Preserve keyboard reachability for interactive elements.
- Keep sprite/hero assets optimized and bounded in size.
- Avoid introducing decorative perpetual motion.

## Troubleshooting

### Projects/Writings show unavailable or empty

- Confirm local server is running over HTTP, not `file://`.
- Verify JSON files exist and parse:
  - `data/writings.json`
  - `data/works-substack.json`
- Re-run Substack sync:
  - `python scripts/sync_substack_content.py --diagnostics`

### Known failure signature (March 1, 2026)

- Workflow run: `https://github.com/jkull04/personal_site/actions/runs/22553269839`
- Failing step: `Deploy GitHub Pages / deploy / Sync Substack content`
- Failure time: `2026-03-01T21:37:16Z`
- Check details: root cause happened in sync step before asset validation/deploy steps began.
- Mitigation now in place: deterministic retries, structured diagnostics, and scheduled verification workflow.

### Projects post missing after sync

- Confirm the post is public and tagged `Projects`.
- Confirm exact `H4` headings are present:
  - `Problem`
  - `Approach`
  - `Output`

### Sprite animation looks clipped or unstable

- Re-run normalization script.
- Re-run validation script with default display checks.

### GitHub Pages route issues

- Keep canonical trailing-slash routes.
- Ensure legacy `*.html` shims continue redirecting to canonical paths.
