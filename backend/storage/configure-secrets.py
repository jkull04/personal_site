"""Set Worker secrets through stdin. Run only after Cloudflare login and R2 activation."""
import getpass
import hashlib
import pathlib
import re
import secrets
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
access = (root / 'js/studio-access.js').read_text()
salt = re.search(r"const SALT = '([a-f0-9]+)'", access).group(1)
verifier = re.search(r"const VERIFIER = '([a-f0-9]+)'", access).group(1)
password = getpass.getpass('Existing Studio password: ')
raw = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000)
if hashlib.sha256(raw).hexdigest() != verifier:
    raise SystemExit('Password does not match the existing Studio gate. No secrets changed.')
credential = hashlib.sha256(('studio-service-v1:' + raw.hex()).encode()).hexdigest()
token = getpass.getpass('GitHub token (personal_site only; Contents read/write): ').strip()
if not token:
    raise SystemExit('A repository-scoped GitHub token is required. No secrets changed.')
values = {
    'STUDIO_AUTH_SHA256': hashlib.sha256(credential.encode()).hexdigest(),
    'SESSION_SECRET': secrets.token_hex(32),
    'GITHUB_TOKEN': token,
}
for name, value in values.items():
    subprocess.run(['npx', 'wrangler@4', 'secret', 'put', name], input=value+'\n',
                   text=True, check=True, cwd=pathlib.Path(__file__).parent)
print('Secrets configured. Re-running this command invalidates existing cloud sessions.')
