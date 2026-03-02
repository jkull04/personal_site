#!/usr/bin/env python3
import json
from urllib.request import Request, urlopen

REPO = "jkull04/personal_site"
RUN_ID = 22554604596

def fetch(url):
    req = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "debug"})
    return json.loads(urlopen(req, timeout=15).read())

# Get check suites for the commit
run = fetch(f"https://api.github.com/repos/{REPO}/actions/runs/{RUN_ID}")
sha = run["head_sha"]

# Try check suites
suites = fetch(f"https://api.github.com/repos/{REPO}/commits/{sha}/check-suites")
for suite in suites.get("check_suites", []):
    print(f"Suite: {suite['id']} app={suite.get('app', {}).get('name', '?')} conclusion={suite.get('conclusion')}")

# Try check runs for the commit
check_runs = fetch(f"https://api.github.com/repos/{REPO}/commits/{sha}/check-runs")
for cr in check_runs.get("check_runs", []):
    print(f"\nCheck run: {cr['name']} (id={cr['id']})")
    output = cr.get("output", {})
    title = output.get("title", "")
    summary = output.get("summary", "")
    text = output.get("text", "")
    if title:
        print(f"  Title: {title}")
    if summary:
        print(f"  Summary ({len(summary)} chars):\n{summary[:3000]}")
    if text:
        print(f"  Text ({len(text)} chars):\n{text[:3000]}")
