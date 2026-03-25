#!/usr/bin/env python3
"""Push a single Substack post into the site data files and commit + push.

Run this locally after publishing a new post on Substack:

    python scripts/local_substack_push.py https://jameskull.substack.com/p/my-post

What it does:
  1. Fetches the post page from your local IP (bypasses Cloudflare bot detection)
  2. Extracts post metadata via the window._preloads payload
  3. Merges the post into data/writings.json and data/works-substack.json
  4. Commits the updated files and pushes to origin/main

Flags:
  --dry-run       Preview changes without writing files or running git
  --no-push       Write files and commit, but skip the git push
  --timeout N     HTTP timeout in seconds (default: 30)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

# Allow importing from the scripts package regardless of working directory.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import sync_substack_content as sync


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_post(url: str, *, timeout: float) -> dict[str, Any]:
    """Fetch a Substack post dict from its public URL."""
    html = sync.fetch_text(url, timeout_seconds=timeout)
    preload = sync._extract_preloads_payload(html, page_url=url)
    post = preload.get("post")
    if not isinstance(post, dict):
        raise RuntimeError(f"Could not find post data in preload payload for {url!r}")
    return post


def _merge_into_existing(
    new_writings: list[dict[str, Any]],
    new_projects: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Upsert new entries by id into the existing data files."""
    existing_writings, existing_projects = sync.load_existing_outputs()
    merged_writings = sync.merge_entries_by_id(new_writings, existing_writings)
    merged_projects = sync.merge_entries_by_id(new_projects, existing_projects)
    return merged_writings, merged_projects


def _run_git(args: list[str], *, cwd: Path) -> None:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {result.returncode}):\n"
            f"{result.stderr.strip() or result.stdout.strip()}"
        )


def _git_has_changes(paths: list[Path], *, cwd: Path) -> bool:
    result = subprocess.run(
        ["git", "diff", "--quiet", "--", *[str(p) for p in paths]],
        cwd=cwd,
    )
    return result.returncode != 0  # non-zero means there are differences


def _commit_and_push(
    writings_path: Path,
    projects_path: Path,
    slug: str,
    *,
    push: bool,
    cwd: Path,
) -> None:
    changed = _git_has_changes([writings_path, projects_path], cwd=cwd)
    if not changed:
        print("No changes to commit — data files are already up to date.")
        return

    _run_git(["add", str(writings_path), str(projects_path)], cwd=cwd)
    _run_git(["commit", "-m", f"chore: add Substack post '{slug}'"], cwd=cwd)
    print(f"✓ Committed data changes for '{slug}'")

    if push:
        _run_git(["push"], cwd=cwd)
        print("✓ Pushed to remote")
    else:
        print("  (skipping push — run 'git push' when ready)")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "url",
        help="Full URL of the Substack post, e.g. https://jameskull.substack.com/p/my-post",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse the post, but do not write files or run git.",
    )
    parser.add_argument(
        "--no-push",
        action="store_true",
        help="Write and commit the data files, but do not run 'git push'.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        metavar="SECONDS",
        help="HTTP timeout in seconds (default: 30).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    url: str = args.url.strip()
    dry_run: bool = args.dry_run
    push: bool = not args.no_push
    timeout: float = max(5.0, float(args.timeout))

    print(f"Fetching post: {url}")
    try:
        post = _fetch_post(url, timeout=timeout)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    slug = str(post.get("slug") or "").strip()
    title = str(post.get("title") or "").strip()
    audience = str(post.get("audience") or "").strip()
    is_published = post.get("is_published")

    print(f"  slug      : {slug!r}")
    print(f"  title     : {title!r}")
    print(f"  published : {is_published!r}  audience: {audience!r}")

    if not slug:
        print("Error: post has no slug — cannot continue.", file=sys.stderr)
        return 1

    try:
        config = sync.load_config(sync.CONFIG_PATH)
    except Exception as exc:
        print(f"Error loading config: {exc}", file=sys.stderr)
        return 1

    new_writings = sync.to_writings_entries([post], config)
    new_projects = sync.to_project_entries([post], config)

    print(f"  writings entries : {len(new_writings)}")
    print(f"  project entries  : {len(new_projects)}")

    if not new_writings and not new_projects:
        print(
            "\nWarning: post produced no entries. Check that:\n"
            "  • The post is published and audience is 'everyone'\n"
            "  • It has the correct tag (Essays, Notes, or Projects) on Substack\n"
            "  • Project posts have the required H4 sections (Problem, Approach, Output)"
        )

    if dry_run:
        print("\n[dry-run] No files written. Proposed output:")
        print("  writings.json:", json.dumps(new_writings, indent=2, ensure_ascii=False))
        print("  works-substack.json:", json.dumps(new_projects, indent=2, ensure_ascii=False))
        return 0

    try:
        merged_writings, merged_projects = _merge_into_existing(new_writings, new_projects)
        sync.write_outputs_atomically(merged_writings, merged_projects)
    except Exception as exc:
        print(f"Error writing data files: {exc}", file=sys.stderr)
        return 1

    print(f"✓ Wrote data/writings.json ({len(merged_writings)} entries)")
    print(f"✓ Wrote data/works-substack.json ({len(merged_projects)} entries)")

    try:
        _commit_and_push(
            sync.WRITINGS_PATH,
            sync.WORKS_SUBSTACK_PATH,
            slug,
            push=push,
            cwd=ROOT,
        )
    except Exception as exc:
        print(f"Error during git operations: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
