#!/usr/bin/env python3
"""Apply a single Substack post payload from a GitHub event into site JSON files."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import sync_substack_content as sync


def _load_event(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object in event payload: {path}")
    return payload


def _coerce_payload_post(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    raise RuntimeError("Bridge payload did not include a usable Substack post object.")


def _extract_post_from_event(event: dict[str, Any]) -> dict[str, Any]:
    client_payload = event.get("client_payload")
    if not isinstance(client_payload, dict):
        raise RuntimeError("Expected `client_payload` in GitHub repository_dispatch event.")

    if "post" in client_payload:
        return _coerce_payload_post(client_payload["post"])

    if "post_json" in client_payload:
        return _coerce_payload_post(client_payload["post_json"])

    if "page_html" in client_payload:
        page_html = str(client_payload.get("page_html") or "")
        page_url = str(client_payload.get("page_url") or client_payload.get("link") or "").strip()
        if not page_html or not page_url:
            raise RuntimeError("Bridge payload with `page_html` also requires `page_url` or `link`.")
        preload = sync._extract_preloads_payload(page_html, page_url=page_url)
        post = preload.get("post")
        if isinstance(post, dict):
            return post

    raise RuntimeError(
        "Bridge payload must provide one of `post`, `post_json`, or `page_html` + `page_url`."
    )


def _replace_entry(existing: list[dict[str, Any]], entry_id: str, new_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    preserved = [item for item in existing if str(item.get("id") or "").strip() != entry_id]
    combined = preserved + new_items
    combined.sort(key=lambda item: str(item.get("date") or ""), reverse=True)
    return combined


def apply_post(post: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    config = sync.load_config(sync.CONFIG_PATH)
    writings, projects = sync.load_existing_outputs()

    slug = str(post.get("slug") or "").strip()
    if not slug:
        raise RuntimeError("Bridge payload post is missing `slug`.")
    entry_id = sync.normalize_slug(slug)

    next_writings = sync.to_writings_entries([post], config)
    next_projects = sync.to_project_entries([post], config)

    writings = _replace_entry(writings, entry_id, next_writings)
    projects = _replace_entry(projects, entry_id, next_projects)
    return writings, projects


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--event-path",
        type=str,
        required=True,
        help="Path to the GitHub event payload JSON file.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    event = _load_event(Path(args.event_path))
    post = _extract_post_from_event(event)
    writings, projects = apply_post(post)
    sync.write_outputs_atomically(writings, projects)
    print(
        "Applied bridge payload",
        json.dumps(
            {
                "slug": post.get("slug"),
                "writings_entries": len(writings),
                "project_entries": len(projects),
            },
            ensure_ascii=False,
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
