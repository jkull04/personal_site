#!/usr/bin/env python3
import json
from datetime import datetime
from urllib.request import Request, urlopen

REPO = "jkull04/personal_site"

def fetch(url):
    req = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "debug"})
    return json.loads(urlopen(req, timeout=15).read())

runs = fetch(f"https://api.github.com/repos/{REPO}/actions/runs?per_page=3")
for r in runs.get("workflow_runs", []):
    if r["name"] == "Deploy GitHub Pages":
        rid = r["id"]
        status = r["status"]
        conclusion = r["conclusion"]
        sha = r["head_sha"][:10]
        print(f"Run {rid} | SHA={sha} | status={status} | conclusion={conclusion}")

        if status == "completed":
            jobs = fetch(f"https://api.github.com/repos/{REPO}/actions/runs/{rid}/jobs")
            for job in jobs.get("jobs", []):
                print(f"  Job: {job['name']} -> {job['conclusion']}")
                for step in job.get("steps", []):
                    marker = "FAIL" if step.get("conclusion") == "failure" else "  ok"
                    s = step.get("started_at", "")
                    e = step.get("completed_at", "")
                    dur = ""
                    if s and e:
                        t0 = datetime.fromisoformat(s.replace("Z", "+00:00"))
                        t1 = datetime.fromisoformat(e.replace("Z", "+00:00"))
                        dur = f" ({(t1 - t0).total_seconds():.0f}s)"
                    print(f"    [{marker}] {step['name']}{dur} -> {step.get('conclusion', '?')}")
        break
