# Security controls

The Studio password unlocks encrypted browser drafts. It is not a publishing
credential. Publishing requires the owner's repository-scoped GitHub token;
GitHub's permissions remain the write boundary. The service encrypts the token
with a server-only key for a revocable, 12-hour session. Disconnect and Lock
Studio delete the server session. An hourly alarm cleans expired sessions.
`AUTH_VERSION` or signing-key rotation invalidates all existing sessions.
Legacy password-derived service credentials and v1 sessions are rejected.

Existing draft keys and IndexedDB data remain unchanged. Backup exports use
AES-GCM through the draft key, and are restored after unlocking Studio with the
same password. Legacy plaintext backups can still be imported. Unpublished
entries and unrelated pending images are never included in publication.

Studio starts with its login and editor hidden. It refuses to initialize in any
frame, including sandboxed frames, and fails closed if scripts do not run.
GitHub Pages does not supply configurable HTTP response headers here. Adding
response-level `frame-ancestors`, X-Frame-Options, and HSTS still requires an edge
proxy or hosting change; do not mistake a meta tag for those response headers.

Unknown cloud photo keys do not consume the shared R2 read allowance. Only
completed ledger entries can spend it, and uncached reads are additionally
limited per client before reaching storage. Cloudflare Free-plan limits remain
part of cost protection; the R2 budget is not an account-wide dollar cap.

All deployment actions are SHA-pinned. Wrangler has an exact version and lockfile;
Python image tooling is version- and hash-pinned. Dependency installs precede the
credential-bearing deployment step. No full-repository deployment cleanup was
included in this security change.

## Checked publication

`Security checks` runs Node and Python tests on pull requests, main, and
`studio-check/**` branches. Studio stages a proposed immutable commit, waits for
that commit's successful GitHub Actions check, then moves main without force.
Retries reuse the same tree and parent. Successful publication removes its
temporary check branch. Failed/pending branches retain proposed public content.

Main's protection requires this check and disallows force pushes/deletion,
including administrator bypass. Review requirements are not enabled because
this single-owner site supports direct checked content publication.

The local Substack refresh uses `scripts/push_checked.py` to follow this flow.
The Actions refresh runs the same tests, verifies its commit changes only the
two permitted Substack JSON files, and records a GitHub Actions status before
pushing. Its default token cannot trigger recursive workflows.

Run tests with Node 22 and Python 3.13:

```sh
node --test tests/*.test.js tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
```

To rotate the server signing/encryption key, install locked tooling with
`npm ci --ignore-scripts` in `backend/storage`, then run its
`configure-secrets.py`. This revokes sessions without changing local draft keys.
