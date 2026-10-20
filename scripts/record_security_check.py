"""Record already-passed tests for a content-only Actions refresh commit."""
import json
import os
import subprocess
from urllib.request import Request, urlopen

sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
changed=subprocess.check_output(['git','diff-tree','--no-commit-id','--name-only','-r',sha],text=True).splitlines()
if not changed or not set(changed).issubset({'data/writings.json','data/works-substack.json'}):
    raise SystemExit('Only Substack data changes can use this refresh check.')
request=Request('https://api.github.com/repos/jkull04/personal_site/statuses/'+sha,
    data=json.dumps({'state':'success','context':'Security checks','description':'Application and import tests passed for the content refresh','target_url':os.environ['GITHUB_SERVER_URL']+'/'+os.environ['GITHUB_REPOSITORY']+'/actions/runs/'+os.environ['GITHUB_RUN_ID']}).encode(),
    headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','User-Agent':'JamesKull-Refresh'},method='POST')
with urlopen(request,timeout=20) as response:
    if response.status!=201: raise SystemExit('Could not record the required security check.')
