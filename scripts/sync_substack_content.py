#!/usr/bin/env python3
"""Sync Substack posts into site JSON content files.

Outputs:
- data/writings.json
- data/works-substack.json
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "substack.config.json"
WRITINGS_PATH = ROOT / "data" / "writings.json"
WORKS_SUBSTACK_PATH = ROOT / "data" / "works-substack.json"


class TextExtractor(HTMLParser):
    """Extract plain text from HTML while preserving basic block separation."""

    BLOCK_TAGS = {
        "p",
        "div",
        "section",
        "article",
        "ul",
        "ol",
        "li",
        "blockquote",
        "pre",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if data:
            self.parts.append(data)

    def text(self) -> str:
        raw = "".join(self.parts)
        raw = re.sub(r"[ \t\r\f\v]+", " ", raw)
        raw = re.sub(r"\n\s*\n+", "\n", raw)
        return raw.strip()


@dataclass(frozen=True)
class SyncConfig:
    publication_host: str
    writings_tag: str
    blog_tag: str
    projects_tag: str
    required_sections: list[str]
    optional_sections: list[str]
    page_limit: int
    max_pages: int


def load_config(path: Path) -> SyncConfig:
    data = json.loads(path.read_text(encoding="utf-8"))
    tags = data.get("tags", {})
    project_template = data.get("project_template", {})
    pagination = data.get("pagination", {})
    return SyncConfig(
        publication_host=str(data["publication_host"]).strip().lower(),
        writings_tag=str(tags["writings"]).strip(),
        blog_tag=str(tags["blog"]).strip(),
        projects_tag=str(tags["projects"]).strip(),
        required_sections=[str(value).strip() for value in project_template.get("required_sections", [])],
        optional_sections=[str(value).strip() for value in project_template.get("optional_sections", [])],
        page_limit=max(1, int(pagination.get("limit", 20))),
        max_pages=max(1, int(pagination.get("max_pages", 200))),
    )


def fetch_json(url: str) -> Any:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "PersonalWebsiteSubstackSync/1.0",
        },
    )
    with urlopen(request, timeout=20) as response:
        content_type = response.headers.get("Content-Type", "")
        if "application/json" not in content_type.lower():
            raise RuntimeError(f"Unexpected content type for {url}: {content_type}")
        body = response.read().decode("utf-8")
    return json.loads(body)


def fetch_posts(config: SyncConfig) -> list[dict[str, Any]]:
    base = f"https://{config.publication_host}/api/v1/posts"
    posts: list[dict[str, Any]] = []

    for page in range(config.max_pages):
        params = {"limit": config.page_limit, "offset": page * config.page_limit}
        url = f"{base}?{urlencode(params)}"
        page_data = fetch_json(url)
        if not isinstance(page_data, list):
            raise RuntimeError(f"Unexpected posts payload shape at {url}")
        if not page_data:
            break
        posts.extend([post for post in page_data if isinstance(post, dict)])

        if len(page_data) < config.page_limit:
            break
    else:
        print(
            f"Reached max_pages={config.max_pages} while fetching posts; truncating results.",
            file=sys.stderr,
        )

    return posts


def post_is_public(post: dict[str, Any]) -> bool:
    return bool(post.get("is_published", True)) and str(post.get("audience", "")).lower() == "everyone"


def extract_tags(post: dict[str, Any]) -> list[str]:
    tags = []
    raw_tags = post.get("postTags")
    if not isinstance(raw_tags, list):
        return tags

    for tag in raw_tags:
        if not isinstance(tag, dict):
            continue
        name = str(tag.get("name", "")).strip()
        if name:
            tags.append(name)
    return tags


def normalize_date(post_date: str) -> str:
    if not post_date:
        return ""
    try:
        parsed = datetime.fromisoformat(post_date.replace("Z", "+00:00"))
    except ValueError:
        return ""
    return parsed.date().isoformat()


def normalize_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "untitled"


def normalize_post_url(post: dict[str, Any], publication_host: str) -> str:
    slug = str(post.get("slug", "")).strip()
    fallback = f"https://{publication_host}/p/{slug}" if slug else f"https://{publication_host}"

    canonical = str(post.get("canonical_url", "")).strip()
    if not canonical:
        return fallback

    parsed = urlparse(canonical)
    host = parsed.netloc.lower()
    path = parsed.path or ""

    if "/home/post/" in path:
        return fallback

    if host == publication_host or host.endswith(f".{publication_host}"):
        return canonical

    return fallback


def html_to_text(html: str) -> str:
    parser = TextExtractor()
    parser.feed(html or "")
    parser.close()
    return unescape(parser.text())


def first_text_snippet(post: dict[str, Any], max_chars: int = 220) -> str:
    body_html = str(post.get("body_html") or "")
    if not body_html:
        return ""
    text = html_to_text(body_html)
    if len(text) <= max_chars:
        return text
    cut = text[: max_chars - 1].rstrip()
    return f"{cut}..."


def extract_abstract(post: dict[str, Any]) -> str:
    for key in ("subtitle", "description", "truncated_body_text"):
        value = str(post.get(key) or "").strip()
        if value:
            return value
    return first_text_snippet(post)


def extract_project_summary(post: dict[str, Any]) -> str:
    for key in ("subtitle", "description", "truncated_body_text"):
        value = str(post.get(key) or "").strip()
        if value:
            return value
    return first_text_snippet(post)


def split_sections_from_html(body_html: str) -> dict[str, str]:
    if not body_html:
        return {}

    sections: dict[str, str] = {}
    parts = re.split(r"(?is)<h4[^>]*>(.*?)</h4>", body_html)
    # Format: [before, heading1, content1, heading2, content2, ...]
    if len(parts) < 3:
        return sections

    for index in range(1, len(parts), 2):
        heading_html = parts[index]
        content_html = parts[index + 1] if index + 1 < len(parts) else ""
        heading_text = html_to_text(heading_html).strip()
        content_text = html_to_text(content_html).strip()
        if heading_text:
            sections[heading_text.lower()] = content_text
    return sections


def parse_project_metadata_h6(body_html: str) -> dict[str, str]:
    if not body_html:
        return {}

    valid_keys = {
        "tools",
        "outcome",
        "stack",
        "role",
        "github",
        "demo",
        "video",
        "docs",
        "slides",
    }
    h6_matches = re.findall(r"(?is)<h6[^>]*>(.*?)</h6>", body_html)

    for raw in reversed(h6_matches):
        line = html_to_text(raw)
        if not line:
            continue

        parsed: dict[str, str] = {}
        for segment in line.split("|"):
            token = segment.strip()
            if ":" not in token:
                continue
            key, value = token.split(":", 1)
            normalized_key = key.strip().lower()
            normalized_value = value.strip()
            if normalized_key in valid_keys and normalized_value:
                parsed[normalized_key] = normalized_value

        if parsed:
            return parsed

    return {}


def extract_project_links(default_url: str, parsed_h6: dict[str, str]) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    seen: set[str] = set()

    def add_link(label: str, href: str) -> None:
        normalized = str(href).strip()
        if not re.match(r"^https?://", normalized, flags=re.IGNORECASE):
            return
        lower = normalized.lower()
        if lower in seen:
            return
        seen.add(lower)
        links.append({"label": label, "href": normalized})

    add_link("Project Post", default_url)
    add_link("GitHub", parsed_h6.get("github", ""))
    add_link("Demo", parsed_h6.get("demo", ""))
    add_link("Demo Video", parsed_h6.get("video", ""))
    add_link("Docs", parsed_h6.get("docs", ""))
    add_link("Slides", parsed_h6.get("slides", ""))
    return links


def to_writings_entries(posts: list[dict[str, Any]], config: SyncConfig) -> list[dict[str, Any]]:
    writings: list[dict[str, Any]] = []
    projects_key = config.projects_tag.lower()
    blog_key = config.blog_tag.lower()
    writings_key = config.writings_tag.lower()

    for post in posts:
        if not post_is_public(post):
            continue

        tags = extract_tags(post)
        tags_lower = {tag.lower() for tag in tags}

        if projects_key in tags_lower:
            continue

        entry_type = None
        if blog_key in tags_lower:
            entry_type = "blog"
        elif writings_key in tags_lower:
            entry_type = "essay"

        if entry_type is None:
            continue

        title = str(post.get("title") or "").strip()
        slug = str(post.get("slug") or "").strip()
        date = normalize_date(str(post.get("post_date") or ""))
        if not title or not slug or not date:
            continue

        writings.append(
            {
                "id": normalize_slug(slug),
                "type": entry_type,
                "title": title,
                "date": date,
                "tags": tags,
                "abstract": extract_abstract(post),
                "href": normalize_post_url(post, config.publication_host),
            }
        )

    writings.sort(key=lambda entry: entry.get("date", ""), reverse=True)
    return writings


def to_project_entries(posts: list[dict[str, Any]], config: SyncConfig) -> list[dict[str, Any]]:
    projects: list[dict[str, Any]] = []
    projects_key = config.projects_tag.lower()
    required = [name.lower() for name in config.required_sections]
    optional = [name.lower() for name in config.optional_sections]

    for post in posts:
        if not post_is_public(post):
            continue

        tags = extract_tags(post)
        tags_lower = {tag.lower() for tag in tags}
        if projects_key not in tags_lower:
            continue

        title = str(post.get("title") or "").strip()
        slug = str(post.get("slug") or "").strip()
        date = normalize_date(str(post.get("post_date") or ""))
        if not title or not slug or not date:
            print(f"Skipping projects post with missing identity fields: slug={slug!r}", file=sys.stderr)
            continue

        body_html = str(post.get("body_html") or "")
        sections = split_sections_from_html(body_html)
        missing_required = [name for name in required if not sections.get(name)]
        if missing_required:
            print(
                f"Skipping project post '{slug}': missing required H4 sections: {', '.join(missing_required)}",
                file=sys.stderr,
            )
            continue

        h6_metadata = parse_project_metadata_h6(body_html)
        tools = sections.get("tools") if "tools" in optional else ""
        outcome = sections.get("outcome") if "outcome" in optional else ""
        summary = extract_project_summary(post)
        resolved_tools = h6_metadata.get("tools") or tools or "Substack"
        resolved_outcome = h6_metadata.get("outcome") or outcome or summary or "Project update published on Substack."
        metadata: dict[str, str] = {
            "tools": resolved_tools,
            "outcome": resolved_outcome,
        }
        if h6_metadata.get("stack"):
            metadata["stack"] = h6_metadata["stack"]
        if h6_metadata.get("role"):
            metadata["role"] = h6_metadata["role"]

        canonical_url = normalize_post_url(post, config.publication_host)
        projects.append(
            {
                "id": normalize_slug(slug),
                "title": title,
                "date": date,
                "summary": summary,
                "tags": tags,
                "year": date[:4],
                "tools": resolved_tools,
                "outcome": resolved_outcome,
                "metadata": metadata,
                "problem": sections["problem"],
                "approach": sections["approach"],
                "output": sections["output"],
                "links": extract_project_links(canonical_url, h6_metadata),
            }
        )

    projects.sort(key=lambda entry: entry.get("date", ""), reverse=True)
    return projects


def write_json_atomically(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    temp_file: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
            temp_file = handle.name
        try:
            os.replace(temp_file, path)
        except PermissionError:
            # Fallback for synced folders that may block atomic rename operations.
            path.write_text(serialized, encoding="utf-8")
            os.unlink(temp_file)
        temp_file = None
    finally:
        if temp_file and os.path.exists(temp_file):
            os.unlink(temp_file)


def write_outputs_atomically(writings: list[dict[str, Any]], projects: list[dict[str, Any]]) -> None:
    # Keep "last good" behavior by computing everything up front, then replacing files.
    write_json_atomically(WRITINGS_PATH, writings)
    write_json_atomically(WORKS_SUBSTACK_PATH, projects)


def main() -> int:
    try:
        config = load_config(CONFIG_PATH)
        posts = fetch_posts(config)
        writings = to_writings_entries(posts, config)
        projects = to_project_entries(posts, config)
        write_outputs_atomically(writings, projects)
        print(f"Sync completed: {len(writings)} writings, {len(projects)} project entries.")
        return 0
    except (HTTPError, URLError, TimeoutError) as exc:
        print(f"Substack sync failed due to network/API error: {exc}", file=sys.stderr)
        return 1
    except (KeyError, TypeError, ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
        print(f"Substack sync failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
