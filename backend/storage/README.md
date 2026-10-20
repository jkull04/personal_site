# Studio photo storage

Status: active in production. See `SECURITY.md` for the October 2026 security
controls and checked publishing process.

## Architecture

GitHub Pages serves the site. Studio still resizes to a 2400px JPEG plus a 960px
thumbnail. Only included photos upload when Publish is pressed. The browser
connects using an owner GitHub token scoped to this repository. The Worker
encrypts it with a server-only key and issues a revocable 12-hour session.
Publishing uses that connecting token. The Studio password only unlocks local
encrypted drafts; it cannot authorize remote writes.

The Worker uploads to a **private** Standard R2 bucket, using SHA-256 filenames
for retry safety. It serves API requests and images at
`jameskull-studio-storage.fitzykull.workers.dev`, with edge caching for images.
Only `/photos/<hash>.jpg` is public; upload and publish routes require a session.
This avoids a DNS migration for the existing GitHub Pages site. Do NOT attach
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
- 20,000 uncached R2 image reads per UTC day for completed ledger entries.
  Unknown keys return 404 without spending this allowance. Uncached requests
  also have a per-client rate limit before storage access.
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

1. R2 is active with owner approval, the private bucket exists, Workers is on
   Free, and $1/$5 account alerts are configured. Keep these settings.
2. Use the existing `fitzykull.workers.dev` subdomain. No website DNS changes
   are needed. The feature flag remains off until live verification completes.
3. The restricted user token `Website storage deployment` has Workers Scripts
   edit and Workers R2 Storage edit for this account only. Save it as the
   encrypted GitHub Actions repository secret `STUDIO_CLOUDFLARE_API_TOKEN`
   after approval. The workflow `.github/workflows/deploy-studio-storage.yml`
   runs the tests, bundles with Wrangler, then deploys. It has read-only
   repository access and does not run on pull-request events. GitHub Pages
   deployment remains separate. The Cloudflare Builds UI did not list this
   custom token, so that broader auto-token route is not used.
4. Install the pinned tooling with `npm ci --ignore-scripts` in `backend/storage`.
   Configure `SESSION_SECRET` with `python3 configure-secrets.py` on a machine
   with Wrangler access. Rotation revokes every existing publishing session.
   The old `GITHUB_TOKEN` and `STUDIO_AUTH_SHA256` runtime secrets are unused.
5. Deploy the storage workflow. Keep the existing Durable Object namespace and
   private bucket; do not reset the ledger or run a fresh migration over data.
6. Confirm account-wide budget alerts remain enabled.
7. Verify unauthenticated writes fail and public R2 access is disabled.
8. In Studio, unlock local drafts, open GitHub connection, and connect a
   fine-grained token scoped to `jkull04/personal_site`, Contents read/write.
   The page clears the token field. Disconnect or Lock Studio revokes the
   server session. Closing a tab alone does not revoke it; it expires in 12 hours.
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
node --test tests/*.test.js tests/*.test.mjs
```

Tests cover authentication, origin restrictions, rate limits, upload retry,
concurrent storage reservations, hard request cutoffs, missing images, raw GitHub
metadata over 1 MB, private-draft exclusion, interrupted upload recovery, and
atomic publication. These use mocked Cloudflare bindings and GitHub; they do not
substitute for the deployment smoke test.

The collection validation ceiling is now 50,000 books/photos. Large browser lists
may need pagination well before that point; this change does not claim that
rendering tens of thousands of editor cards is performant.

