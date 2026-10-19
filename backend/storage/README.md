# Studio photo storage

Status: implemented and covered by local tests; Cloudflare resources and live
end-to-end verification are still required. `data/studio-storage.json` remains
disabled until activation. Disabled mode retains direct GitHub publishing.

## Architecture

GitHub Pages serves the site. Studio still resizes to a 2400px JPEG plus a 960px
thumbnail. Only included photos upload when Publish is pressed. The browser
sends a separate password-derived service credential to the authenticated
Worker, which issues a signed 12-hour session. GitHub credentials stay in Worker
secrets. The encrypted browser draft and its existing session behavior remain.

The Worker uploads to a **private** Standard R2 bucket, using SHA-256 filenames
for retry safety. It serves images at `images.jameskull.com`, with edge caching.
Both that domain and `studio-api.jameskull.com` route to the Worker. Do NOT attach
a public R2 domain or enable r2.dev: those would bypass the request budget.

Publishing reuses StudioCore on the server. It checks the latest GitHub baseline,
preserves unrelated files, and updates main without force in a single commit.
Cloud failures preserve the browser draft. New photo URLs replace draft paths
only after a successful publish. Private drafts and their images are never sent.

## Budget protection

A single SQLite Durable Object (`photos-v1`) transactionally enforces:

- 8,000,000,000 reserved image bytes; warning at 6,000,000,000 bytes.
- 40,000 distinct image files (normally 20,000 photos including thumbnails).
- 1,000 R2 writes per UTC day (normally 500 photos, including thumbnails).
- 20,000 uncached R2 image reads per UTC day, including unsuccessful lookups.
- 12 MiB per optimized image and 450 new photos per publish request.

Keep **Workers on the Free plan**. Its request/compute limits and the free
SQLite Durable Object limits stop service on exhaustion instead of billing
overages. Never enable automatic paid upgrades or paid image transformations.
Browser-side resizing is the only transformation step.

R2 budget: 8 GB stays below its 10 GB allowance; even a 31-day period has at most
31,000 writes and 620,000 reads through this code, below R2's 1M/10M monthly
operation allowances. The Worker makes no R2 list/head calls; statistics and
upload validation use the Durable Object ledger. Cached responses avoid R2 reads.
If the budget service fails, uncached reads and uploads fail closed. Already
cached photos can continue to load until the Workers free request cap is reached.
No service can promise an account-wide dollar cap: other buckets, manual/API
uploads, other Workers, a plan change, billing-policy changes, or bypassing this
Worker are outside these protections. R2 itself has usage billing, not a hard
dollar cutoff. Add account-wide $1 and $5 budget alerts as secondary monitoring;
alerts alone do not stop charges.

Failed uploads retain conservative byte reservations. Do not reset the budget
namespace or restore it to an older point while keeping newer R2 data. Review and
reconcile reservations before reclaiming capacity. The bucket must start empty
and receive all writes through this Worker. Import existing photos through Studio.
Set `PAUSED` to `true` and redeploy for an emergency stop of new requests. Existing
browser/edge cached copies can persist, as with any public photo.

## One-time activation

1. In Cloudflare, accept R2 subscription terms (currently $0 due now plus usage).
   This requires the owner's approval. Confirm Workers is on Free.
2. Add `jameskull.com` to Cloudflare DNS if needed, copying all existing records
   and preserving GitHub Pages routing, email, and domain registration. Do not
   change nameservers until the complete DNS record set is verified.
3. On a machine with npm and Cloudflare access, run `npx wrangler@4 login` and
   `npx wrangler@4 r2 bucket create jameskull-photos` from this directory.
   Keep the bucket private; use Standard storage only. No paid plan is required.
4. Run `python3 configure-secrets.py`. It prompts without echoing for the existing
   Studio password and a GitHub token scoped to `jkull04/personal_site` with
   Contents read/write. Secrets go to Wrangler via stdin, never files/arguments.
   Approve the requested service access before provisioning credentials.
5. Run `npx wrangler@4 deploy --dry-run`, then `npx wrangler@4 deploy`.
   Confirm both custom domains are active and the SQLite migration succeeded.
6. Add account-wide $1 and $5 budget alerts to the account's billing email.
7. Test a small image upload, publish, reload, retry, and removal in a staging
   environment first. Confirm unauthenticated writes fail and public R2 access
   is disabled. Confirm the real browser session derives the same service key.
8. Set `enabled` to `true` in `data/studio-storage.json`, merge and deploy Pages.
   Studio hides the GitHub token connection and shows usage/guardrail status.
9. Use **Move existing photos to cloud storage** in Studio. This publishes any
   other currently included changes too, so review the draft first. Verify the
   Pages deployment and every migrated image before deleting obsolete repository
   image files. The migration itself deliberately preserves the old assets for
   rollback. Removed photos are unlisted; their R2 objects and reservations remain
   until an intentional cleanup, preserving reversibility.

If you disable the feature after activation, existing cloud URLs still depend on
the Worker: keep it running or restore GitHub photo paths and assets first.

## Verification

From the repository root:

```sh
node --test tests/*.test.js tests/storage.test.mjs
```

Tests cover authentication, origin restrictions, rate limits, upload retry,
concurrent storage reservations, hard request cutoffs, missing images, raw GitHub
metadata over 1 MB, private-draft exclusion, interrupted upload recovery, and
atomic publication. These use mocked Cloudflare bindings and GitHub; they do not
substitute for the deployment smoke test.

The collection validation ceiling is now 50,000 books/photos. Large browser lists
may need pagination well before that point; this change does not claim that
rendering tens of thousands of editor cards is performant.
