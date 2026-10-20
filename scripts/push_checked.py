"""Publish a local commit only after the required GitHub security check succeeds."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import time
from urllib.request import Request, urlopen

def push_checked(cwd: Path) -> None:
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()
    sha = git('rev-parse', 'HEAD')
    branch = 'studio-check/local-' + sha
    git('push', 'origin', 'HEAD:refs/heads/' + branch)
    for attempt in range(60):
        request = Request('https://api.github.com/repos/jkull04/personal_site/commits/' + sha + '/check-runs', headers={'Accept':'application/vnd.github+json','User-Agent':'JamesKull-Checked-Publish'})
        with urlopen(request, timeout=20) as response:
            checks = json.load(response).get('check_runs', [])
        check = next((c for c in checks if c['name']=='Security checks' and c.get('app',{}).get('slug')=='github-actions' and c.get('head_sha')==sha), None)
        if check and check['status']=='completed':
            if check['conclusion']!='success':
                raise RuntimeError('Security checks failed. Production was not changed; the staged branch retains the proposed content.')
            git('push', 'origin', 'HEAD:main')
            try: git('push', 'origin', '--delete', branch)
            except subprocess.CalledProcessError: pass
            return
        time.sleep(5)
    raise RuntimeError('Security checks are still pending. Production was not changed. Retry this command later.')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cwd',type=Path,default=Path.cwd())
    push_checked(parser.parse_args().cwd)
