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
- [Daily Substack Refresh](#daily-substack-refresh)
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
- `assets/images/headshot-square.png` or `assets/images/headshot-square.jpg`: profile image source.
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
- All other public posts, including untagged posts or posts with only topic tags,
  appear in Essays. Category tags are optional for inclusion in Writings.

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

Fetch strategy is source-failover aware:

- Primary source: `api/v1/posts`
- Secondary source: `feed-web` (`/feed` + per-post page preload payload)
- Fallback source: `api/v1/archive` + per-slug detail fetch from `api/v1/posts/{slug}`

Safety guard:

- `--min-public-posts` (default `1`) prevents output overwrite when upstream responses are unexpectedly empty.
- `--merge-baseline` (default enabled) merges `feed-web` results with existing JSON outputs by `id` only when the fallback feed source is used, avoiding feed truncation while still letting authoritative API deletions propagate.

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
python scripts/sync_substack_content.py --diagnostics --source-order posts,feed-web,archive --min-public-posts 1 --merge-baseline
```

Writes:

- `data/writings.json`
- `data/works-substack.json`

### 2) Convert generated art into true pixel assets

```bash
python scripts/pixel_asset_tool.py convert input.png output.png --logical-size 384x256 --pixel-scale 4 --palette adaptive --max-colors 32
python scripts/pixel_asset_tool.py convert input.png output.png --logical-size 592x46 --palette marble
```

Outputs:

- `assets/sprites/stegosaurus-walk-atlas.png`
- `assets/sprites/raptor-walk-atlas.png`
- `assets/sprites/marble-brach-walk-atlas.png`
- `assets/source-art/final-steg.png`
- `assets/source-art/final-raptor.png`
- `assets/source-art/final-longneck.png`
- `assets/illustrations/runtime/hero-home-arena.png`
- `assets/illustrations/runtime/hero-projects-forum.png`
- `assets/illustrations/runtime/hero-writings-pantheon.png`
- `assets/illustrations/runtime/hero-contact-delphi.png`

Use this for ChatGPT/imagegen outputs. The important step is crushing the generated image to a declared logical grid, quantizing it to the project palette, and only then scaling with nearest-neighbor. That makes the result an actual pixel image rather than a high-resolution image that imitates pixels.

```bash
python scripts/pixel_asset_tool.py convert input.png output.png --logical-size 384x256 --pixel-scale 4 --palette adaptive --max-colors 32
python scripts/pixel_asset_tool.py check output.png --palette adaptive --max-colors 32 --pixel-scale 4
```

### 3) Validate sprite atlases

```bash
python scripts/validate_sprite_atlas.py --atlas assets/sprites/stegosaurus-walk-atlas.png
python scripts/validate_sprite_atlas.py --atlas assets/sprites/raptor-walk-atlas.png
python scripts/validate_sprite_atlas.py --atlas assets/sprites/marble-brach-walk-atlas.png
python scripts/pixel_asset_tool.py check assets/illustrations/runtime/hero-home-arena.png assets/illustrations/runtime/hero-projects-forum.png assets/illustrations/runtime/hero-writings-pantheon.png assets/illustrations/runtime/hero-contact-delphi.png --palette adaptive --max-colors 32 --pixel-scale 4
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

 Re-run this script whenever runtime image sources are replaced or re-exported, including the contact headshot.

## Deployment

Workflow file: `.github/workflows/deploy-pages.yml`

Triggers:

- Push to `main`
- Successful completion of `Refresh Substack Content`
- Manual `workflow_dispatch`

Pipeline steps:

1. Checkout repository.
2. Setup Python 3.13.
3. Install the pinned Pillow build (`python -m pip install --require-hashes --only-binary=:all: -r scripts/requirements-build.txt`).
4. Run `python scripts/optimize_runtime_images.py --check`.
5. Configure Pages.
6. Upload full repository artifact.
7. Deploy to GitHub Pages.

Notes:

- Push-based site deploys stay isolated from live Substack network fetches.
- Daily local content pushes deploy through `push`; successful bridge/manual GitHub refreshes deploy through `workflow_run` using the latest `main`.

## Daily Substack Refresh

The daily refresh runs on the owner's Mac through a Codex scheduled task at noon
(local time). Keep the Mac on and Codex running for local scheduled tasks.
It runs once and exits; there is no continuously running sync process.

Run the same refresh manually:

```bash
python3 scripts/refresh_substack_local.py --push
```

Omit `--push` to preview. This command:

1. Creates a temporary, sparse checkout of the latest production `main`.
2. Fetches public Substack posts with the existing tag and project-template rules.
3. Commits only `data/writings.json` and `data/works-substack.json` if they changed.
4. Pushes to `main`, triggering the existing GitHub Pages deployment.
5. Removes the temporary checkout without touching unfinished project edits.

Git must be authenticated for pushing to this repository. Failed fetches preserve
production content; a concurrent update to `main` rejects the push safely. An
unchanged feed produces no commit or deployment. The task reports changed content
or a failure requiring attention and stays quiet when nothing changed.

### Why the schedule moved off GitHub

On September 13, 2026, the GitHub refresh workflow was disabled for inactivity.
Fresh verification runs on both Ubuntu and macOS runners received Substack HTTP
403 challenge responses, while the local Mac fetched the same public posts
successfully. The old workflow also converted failed refreshes to successful runs.

The six-hour GitHub schedule has been removed. The workflow
`.github/workflows/refresh-substack-pages.yml` remains available for manual
`workflow_dispatch` and the optional `substack-post-preload` bridge. It now fails
visibly if both network attempts fail and preserves the last good site data.
Successful bridge/manual refreshes trigger Pages through `workflow_run`.

## Optional Pipedream RSS Bridge

Purpose:

- Trigger the Substack refresh workflow closer to publish time without moving live Substack fetches into the Pages deploy job.
- Keep the daily local refresh as a fallback, while allowing near-real-time refreshes from a free RSS poller.

Recommended flow:

- `Substack RSS` -> `Pipedream RSS trigger` -> `Fetch post page HTML` -> `GitHub repository_dispatch` -> `Refresh Substack Content` -> `Deploy GitHub Pages`

Bridge behavior:

- Bridge-triggered runs do not perform a fresh Substack fetch on the GitHub runner. They apply the post payload sent by Pipedream directly into `data/writings.json` and `data/works-substack.json`.
- The daily local refresh reconciles deletions, older history, and bridge events missed upstream.

### Pipedream setup

Create a new Pipedream workflow with:

1. Trigger: `RSS` -> `New Item in Feed`
2. Feed URL: `https://jameskull.substack.com/feed`
3. Poll interval: `Every 15 minutes`
4. Action: `HTTP / Webhook` -> `Send any HTTP Request`
   - Method: `GET`
   - URL: use the RSS item link from the trigger event
5. Action: `HTTP / Webhook` -> `Send any HTTP Request`

HTTP request settings:

- Method: `POST`
- URL: `https://api.github.com/repos/jkull04/personal_site/dispatches`
- Headers:
  - `Accept: application/vnd.github+json`
  - `Authorization: Bearer {{process.env.GITHUB_TOKEN}}`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`
- Body:

```json
{
  "event_type": "substack-post-preload",
  "client_payload": {
    "page_url": "https://jameskull.substack.com/p/your-post-slug",
    "page_html": "<full html of the Substack post page>"
  }
}
```

In Pipedream, set `page_url` from the RSS trigger's link field and `page_html` from the body returned by the intermediate `GET` request step.

### GitHub token setup

Create a fine-grained personal access token with:

- Repository access: `personal_site` only
- Repository permission: `Contents` -> `Read and write`

Store the raw token value in Pipedream as a secret/environment variable named `GITHUB_TOKEN`.

### Pipedream secret gotchas

- Use `{{process.env.GITHUB_TOKEN}}` in the header, not `{{secrets.GITHUB_TOKEN}}`.
- The secret value should be only the raw GitHub token, not `Bearer ...`.
- Re-enter header names manually if the UI pasted hidden line breaks into a key such as `Accept` or `Authorization`.
- If Pipedream reports invalid characters in the `Authorization` header, delete and recreate the `GITHUB_TOKEN` secret as a single line with no extra spaces or trailing newline.
- Repository dispatch requests must send `event_type` plus a `client_payload`; they do not use the `workflow_dispatch` `ref` body shape.

## Substack Sync Verification Workflow

Workflow file: `.github/workflows/verify-substack-sync.yml`

Purpose:

- Manually run Substack sync diagnostics without deploying.

Triggers:

- Manual `workflow_dispatch`

Verification steps:

1. Checkout repository.
2. Setup Python 3.13.
3. Run `python scripts/sync_substack_content.py --diagnostics --retries 6 --timeout 30 --source-order posts,feed-web,archive --min-public-posts 1`.

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
- Mitigation now in place: source failover, minimum-public-post guard, and a dedicated scheduled refresh-and-deploy workflow.

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



## Books, photography, and Studio

Open `/studio/` to maintain the two collections. The existing Living Ruins theme,
static hosting, arena, Substack pipeline, and domain are unchanged.

1. **Books:** choose Add book, enter title/author, choose a shelf, and optionally
   add a rating, finished date, and reading note.
2. **Photography:** choose or drop up to 20 JPEG/PNG/WebP images. The editor makes
   a 2400px full image and a 960px thumbnail, corrects image orientation, and
   re-encodes JPEGs without EXIF/GPS metadata. Export HEIC/RAW as JPEG first.
3. Add photo descriptions for accessibility, captions, places, and collections.
   Move entries up/down to control display order.
4. Check **Include on public site** for entries ready to publish. Unchecked
   entries remain only in the browser draft, not in the public repository.
5. Expand GitHub connection. Create a fine-grained GitHub token scoped to
   `jkull04/personal_site` with **Contents: Read and write**, choose an expiration,
   and click **Connect GitHub** in Studio. The service holds the token encrypted
   for a revocable 12-hour session. It is never included in drafts or backups.
   Use **Disconnect** or **Lock Studio** to revoke the session.
6. Choose **Publish updates**. Security checks run on the proposed commit
   before it advances `main` without force,
   triggering the existing GitHub Pages deployment. Follow the deployment link
   for completion; a saved commit is not the same as a completed deployment.

Drafts autosave in IndexedDB in the current browser. Download a backup before
changing devices or clearing browser data. Exports are encrypted with the Studio
draft key and contain unpublished entries and pending uploads, but no GitHub
token. Unlock Studio with the same password to restore. Existing plaintext
backups remain importable. See `SECURITY.md` for deployment controls.

The editor reads the latest GitHub commit, compares both published collections
with its saved baseline, and refuses to overwrite newer content. If another
browser changes a collection, download your draft backup, reload published
content, and reapply your edits. A non-forced ref update also rejects concurrent
commits safely. Unrelated Substack updates are preserved.

Public collection files are `data/books.json` and `data/photography.json`.
Photographs live under `assets/photography/`. Removing an entry unlists it on the
next publish; its old image file and Git history remain. Do not upload private
photographs expecting a later removal to erase repository history.

Tests: `node --test tests/studio.test.js`. New routes use the existing canonical
trailing-slash convention: `/books/`, `/photography/`, and `/studio/`.

## Writing in Studio

The Writings tab in `/studio/` supports essays, notes, and projects with a title, subtitle,
date, topics, summary, and body. Drafts use the existing password-unlocked,
encrypted browser storage and backup workflow. Older drafts and backups acquire
the new writing collection without replacing saved books or photographs.

Body text supports paragraphs, `#`/`##`/`###` headings, **bold**, *italic*, inline
code, fenced code, bullet/numbered lists, blockquotes, and HTTP(S) links. Raw HTML
is escaped. Preview uses the same renderer as published articles.

Check **Include on public site**, then **Publish updates**. Studio commits
`data/writings-local.json` and full static pages at
`/writings/posts/<stable-id>/` together. Unpublished drafts are excluded entirely.
Unpublishing/removing an entry deletes its public page on the next publish;
previous versions remain in Git history. Publish retains the existing optimistic
conflict checks and non-forced atomic commit. GitHub Pages deployment must finish
before the website changes are live.

The public writings index merges the Studio collection with `data/writings.json`.
Substack refresh scripts continue to own the latter file only. Projects can also be written in Studio by choosing the Project category. Add
Problem, Approach, and Output; the main body is optional additional detail. They
appear on `/projects/`, with stable full article URLs. The Substack handoff
includes the required H4 headings; add the Projects tag when posting on Substack.

### Substack handoff

After publishing a writing's latest version here, use **Copy title**, optional
**Copy subtitle**, and **Copy for Substack**. The last button copies rich text
plus a plain-text fallback and includes an original-article link. Open the
Substack dashboard, create a post, paste into the corresponding fields, review,
and publish there. Studio does not automatically create a Substack draft, send
email, or publish on Substack. A Markdown download is available when clipboard
access is unavailable.

After publishing there, paste the `https://jameskull.substack.com/p/...` URL into
Studio and publish updates again. The article gains an “Also on Substack” link,
and its exact linked Substack copy is omitted from the combined index. Edits to
the two versions are independent. The URL field records a user-provided link;
it does not verify publication or read private Substack drafts.

Verification: `node --test tests/*.test.js` includes publishing, draft exclusion,
page removal, crosspost matching, conflict rejection, and rendering safety.

