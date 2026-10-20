"""Rotate the server signing/encryption key; existing sessions become invalid."""
import pathlib
import secrets
import subprocess
root=pathlib.Path(__file__).parent
subprocess.run([str(root/'node_modules/.bin/wrangler'),'secret','put','SESSION_SECRET'],input=secrets.token_hex(32)+'\n',text=True,check=True,cwd=root)
print('Session key rotated. Connect GitHub again in Studio. Local drafts are unchanged.')
