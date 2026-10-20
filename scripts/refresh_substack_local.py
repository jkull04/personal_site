#!/usr/bin/env python3
"""Refresh public Substack content in an isolated checkout; use --push to publish."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile


REPOSITORY = "https://github.com/jkull04/personal_site.git"
CONTENT_PATHS = ("data/writings.json", "data/works-substack.json")


def run(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        cwd=cwd,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "PYTHONDONTWRITEBYTECODE": "1"},
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=300,
    )


def refresh(repository: str = REPOSITORY, *, publish: bool = False) -> bool:
    # Never switch branches, stash changes, or commit in the working project.
    with tempfile.TemporaryDirectory(prefix="personal-site-substack-") as temp:
        root = Path(temp)
        checkout = root / "site"
        run([
            "git", "clone", "--depth=1", "--filter=blob:none", "--sparse",
            "--branch", "main", "--single-branch", repository, str(checkout),
        ], root)
        run(["git", "sparse-checkout", "set", "scripts", "data"], checkout)
        result = run([
            sys.executable, "-B", "scripts/sync_substack_content.py",
            "--retries", "2", "--timeout", "20", "--min-public-posts", "1",
            "--merge-baseline",
        ], checkout)
        print(result.stdout.strip())
        if result.stderr.strip():
            print(result.stderr.strip(), file=sys.stderr)
        changed = run(["git", "diff", "--name-only", "--", *CONTENT_PATHS], checkout)
        if not changed.stdout.strip():
            print("No Substack content changes; nothing to publish.")
            return False
        print(run(["git", "diff", "--stat", "--", *CONTENT_PATHS], checkout).stdout.strip())
        if not publish:
            print("Preview only; rerun with --push to publish these content changes.")
            return True
        run(["git", "add", "--", *CONTENT_PATHS], checkout)
        run([
            "git", "-c", "user.name=Substack content sync",
            "-c", "user.email=substack-sync@localhost", "commit",
            "-m", "chore: refresh Substack content",
        ], checkout)
        # A concurrent production update rejects this push rather than being overwritten.
        if repository == REPOSITORY:
            run([sys.executable, "scripts/push_checked.py"], checkout)
        else:
            run(["git", "push", "origin", "HEAD:main"], checkout)
        commit = run(["git", "rev-parse", "HEAD"], checkout).stdout.strip()
        print(f"Published Substack content: {commit}")
        return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--push", action="store_true", help="Commit changed content and push to main")
    args = parser.parse_args()
    try:
        refresh(publish=args.push)
        return 0
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        print(f"Substack refresh failed: {exc}", file=sys.stderr)
        if isinstance(exc, subprocess.CalledProcessError):
            print(exc.stdout or "", file=sys.stderr)
            print(exc.stderr or "", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

