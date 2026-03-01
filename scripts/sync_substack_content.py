#!/usr/bin/env python3
"""Sync Substack posts into site JSON content files.

Outputs:
- data/writings.json
- data/works-substack.json
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import socket
import sys
import tempfile
import time
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
DEFAULT_RETRIES = 3
DEFAULT_TIMEOUT_SECONDS = 20.0
DEFAULT_BACKOFF_BASE_SECONDS = 0.8
DEFAULT_MAX_BACKOFF_SECONDS = 6.0
TRANSIENT_HTTP_CODES = {408, 425, 429, 500, 502, 503, 504}
REDACT_QUERY_KEY_PATTERN = re.compile(r"(token|key|secret|pass|auth)", flags=re.IGNORECASE)
LOG_PREFIX = "[substack-sync]"


@dataclass
class SyncStats:
    fetch_attempts: int = 0
    pages_fetched: int = 0
    posts_received: int = 0
    writings_entries: int = 0
    project_entries: int = 0
    outputs_written: int = 0
    started_at: float = 0.0


class SyncRequestError(RuntimeError):
    def __init__(self, message: str, *, transient: bool = False) -> None:
        super().__init__(message)
        self.transient = transient


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


def log_diagnostic(enabled: bool, message: str) -> None:
    if enabled:
        print(f"{LOG_PREFIX} {message}")


def sanitize_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.query:
        return url

    sanitized_query_parts: list[str] = []
    for token in parsed.query.split("&"):
        if "=" not in token:
            sanitized_query_parts.append(token)
            continue
        key, value = token.split("=", 1)
        if REDACT_QUERY_KEY_PATTERN.search(key):
            sanitized_query_parts.append(f"{key}=***")
        else:
            sanitized_query_parts.append(f"{key}={value}")

    sanitized_query = "&".join(sanitized_query_parts)
    return parsed._replace(query=sanitized_query).geturl()


def sanitize_body_snippet(body: bytes, max_chars: int = 160) -> str:
    text = body.decode("utf-8", errors="replace")
    text = " ".join(text.split())
    if len(text) > max_chars:
        return f"{text[: max_chars - 3]}..."
    return text


def is_transient_network_error(exc: Exception) -> bool:
    if isinstance(exc, TimeoutError):
        return True
    if isinstance(exc, URLError):
        reason = exc.reason
        if isinstance(reason, TimeoutError):
            return True
        if isinstance(reason, socket.timeout):
            return True
        if isinstance(reason, OSError):
            if reason.errno in {101, 103, 104, 110, 111, 112, 113}:
                return True
            reason_text = str(reason).lower()
            return "timed out" in reason_text or "temporary failure" in reason_text or "connection reset" in reason_text
        reason_text = str(reason).lower()
        return "timed out" in reason_text or "connection reset" in reason_text
    if isinstance(exc, socket.timeout):
        return True
    if isinstance(exc, OSError):
        if exc.errno in {101, 103, 104, 110, 111, 112, 113}:
            return True
        reason_text = str(exc).lower()
        return "timed out" in reason_text or "temporary failure" in reason_text or "connection reset" in reason_text
    return False


def backoff_delay(
    attempt: int,
    *,
    base_seconds: float,
    max_seconds: float,
    rng: random.Random,
) -> float:
    exponential = min(max_seconds, base_seconds * (2 ** max(0, attempt - 1)))
    jitter_ceiling = min(0.5, exponential * 0.25)
    jitter = rng.uniform(0.0, jitter_ceiling)
    return min(max_seconds, exponential + jitter)


def write_step_summary(lines: list[str]) -> None:
    summary_path = os.getenv("GITHUB_STEP_SUMMARY", "").strip()
    if not summary_path:
        return
    try:
        with open(summary_path, "a", encoding="utf-8") as summary_file:
            summary_file.write("\n".join(lines) + "\n")
    except OSError:
        # Summary output should not fail the sync operation.
        return


def fetch_json(
    url: str,
    *,
    retries: int = DEFAULT_RETRIES,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    diagnostics: bool = False,
    stats: SyncStats | None = None,
    rng: random.Random | None = None,
) -> Any:
    last_error: SyncRequestError | None = None
    backoff_rng = rng or random.Random(0)
    safe_url = sanitize_url(url)

    for attempt in range(1, retries + 1):
        if stats is not None:
            stats.fetch_attempts += 1

        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "PersonalWebsiteSubstackSync/1.0",
            },
        )
        started = time.monotonic()

        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                status_code = int(getattr(response, "status", 200))
                content_type = response.headers.get("Content-Type", "")
                payload = response.read()
                elapsed_ms = int((time.monotonic() - started) * 1000)
                log_diagnostic(
                    diagnostics,
                    (
                        f"event=fetch_ok attempt={attempt}/{retries} status={status_code} "
                        f"content_type={content_type!r} elapsed_ms={elapsed_ms} url={safe_url}"
                    ),
                )
                if "application/json" not in content_type.lower():
                    snippet = sanitize_body_snippet(payload)
                    raise SyncRequestError(
                        (
                            f"Unexpected content type for {safe_url}: {content_type!r}; "
                            f"body_snippet={snippet!r}"
                        ),
                        transient=False,
                    )
                return json.loads(payload.decode("utf-8"))
        except HTTPError as exc:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            body_snippet = ""
            try:
                if exc.fp is not None:
                    body_snippet = sanitize_body_snippet(exc.fp.read())
            except OSError:
                body_snippet = ""
            transient = exc.code in TRANSIENT_HTTP_CODES
            log_diagnostic(
                diagnostics,
                (
                    f"event=fetch_http_error attempt={attempt}/{retries} status={exc.code} "
                    f"transient={str(transient).lower()} elapsed_ms={elapsed_ms} url={safe_url}"
                ),
            )
            message = f"HTTP {exc.code} for {safe_url}"
            if body_snippet:
                message = f"{message}; body_snippet={body_snippet!r}"
            last_error = SyncRequestError(message, transient=transient)
        except (TimeoutError, URLError, socket.timeout, OSError) as exc:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            transient = is_transient_network_error(exc)
            log_diagnostic(
                diagnostics,
                (
                    f"event=fetch_network_error attempt={attempt}/{retries} transient={str(transient).lower()} "
                    f"elapsed_ms={elapsed_ms} reason={type(exc).__name__} url={safe_url}"
                ),
            )
            last_error = SyncRequestError(f"Network error for {safe_url}: {exc}", transient=transient)
        except json.JSONDecodeError as exc:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            log_diagnostic(
                diagnostics,
                (
                    f"event=fetch_json_error attempt={attempt}/{retries} transient=false "
                    f"elapsed_ms={elapsed_ms} reason={exc.msg!r} url={safe_url}"
                ),
            )
            last_error = SyncRequestError(
                f"Invalid JSON payload from {safe_url}: {exc.msg} (line {exc.lineno}, col {exc.colno})",
                transient=False,
            )
        except SyncRequestError as exc:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            log_diagnostic(
                diagnostics,
                (
                    f"event=fetch_validation_error attempt={attempt}/{retries} transient={str(exc.transient).lower()} "
                    f"elapsed_ms={elapsed_ms} url={safe_url}"
                ),
            )
            last_error = exc

        if last_error is None:
            continue
        if not last_error.transient or attempt >= retries:
            break
        delay = backoff_delay(
            attempt,
            base_seconds=DEFAULT_BACKOFF_BASE_SECONDS,
            max_seconds=DEFAULT_MAX_BACKOFF_SECONDS,
            rng=backoff_rng,
        )
        log_diagnostic(
            diagnostics,
            (
                f"event=retry_wait attempt={attempt}/{retries} sleep_s={delay:.2f} "
                f"url={safe_url}"
            ),
        )
        time.sleep(delay)

    if last_error is None:
        raise SyncRequestError(f"Unable to fetch JSON from {safe_url}", transient=False)
    log_diagnostic(
        diagnostics,
        f"event=fetch_final_error retries={retries} url={safe_url} reason={last_error}",
    )
    raise last_error


def fetch_posts(
    config: SyncConfig,
    *,
    retries: int,
    timeout_seconds: float,
    diagnostics: bool,
    stats: SyncStats,
) -> list[dict[str, Any]]:
    base = f"https://{config.publication_host}/api/v1/posts"
    posts: list[dict[str, Any]] = []

    for page in range(config.max_pages):
        params = {
            "limit": config.page_limit,
            "offset": page * config.page_limit,
        }
        url = f"{base}?{urlencode(params)}"
        page_data = fetch_json(
            url,
            retries=retries,
            timeout_seconds=timeout_seconds,
            diagnostics=diagnostics,
            stats=stats,
        )
        if not isinstance(page_data, list):
            raise RuntimeError(f"Unexpected posts payload shape at {url}")
        if not page_data:
            break
        posts.extend([post for post in page_data if isinstance(post, dict)])
        stats.pages_fetched += 1
        stats.posts_received += len(page_data)
        log_diagnostic(
            diagnostics,
            (
                f"event=page_received page={page + 1} page_size={len(page_data)} "
                f"total_posts={len(posts)}"
            ),
        )

        if len(page_data) < config.page_limit:
            break
    else:
        print(
            f"Reached max_pages={config.max_pages} while fetching posts; truncating results.",
            file=sys.stderr,
        )

    return posts


def post_is_public(post: dict[str, Any]) -> bool:
    return post.get("is_published") is True and str(post.get("audience", "")).lower() == "everyone"


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


def emit_run_summary(status: str, stats: SyncStats, message: str) -> None:
    duration_ms = int((time.monotonic() - stats.started_at) * 1000) if stats.started_at else 0
    summary_line = (
        f"event=run_summary status={status} attempts={stats.fetch_attempts} pages={stats.pages_fetched} "
        f"posts={stats.posts_received} writings={stats.writings_entries} projects={stats.project_entries} "
        f"outputs={stats.outputs_written} duration_ms={duration_ms} message={message!r}"
    )
    print(f"{LOG_PREFIX} {summary_line}")

    write_step_summary(
        [
            "### Substack Sync Summary",
            "",
            f"- Status: `{status}`",
            f"- Message: `{message}`",
            f"- Fetch attempts: `{stats.fetch_attempts}`",
            f"- Pages fetched: `{stats.pages_fetched}`",
            f"- Posts received: `{stats.posts_received}`",
            f"- Writings entries: `{stats.writings_entries}`",
            f"- Project entries: `{stats.project_entries}`",
            f"- Outputs written: `{stats.outputs_written}`",
            f"- Duration (ms): `{duration_ms}`",
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--retries",
        type=int,
        default=DEFAULT_RETRIES,
        help=f"Transient retry count for Substack API requests (default: {DEFAULT_RETRIES}).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"HTTP timeout in seconds per request (default: {DEFAULT_TIMEOUT_SECONDS}).",
    )
    parser.add_argument(
        "--diagnostics",
        action=argparse.BooleanOptionalAction,
        default=bool(os.getenv("CI")),
        help="Enable structured diagnostic logs (defaults to enabled in CI).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    retries = max(1, int(args.retries))
    timeout_seconds = max(1.0, float(args.timeout))
    diagnostics = bool(args.diagnostics)
    stats = SyncStats(started_at=time.monotonic())

    try:
        config = load_config(CONFIG_PATH)
        log_diagnostic(
            diagnostics,
            (
                f"event=run_start host={config.publication_host!r} retries={retries} "
                f"timeout_s={timeout_seconds}"
            ),
        )
        posts = fetch_posts(
            config,
            retries=retries,
            timeout_seconds=timeout_seconds,
            diagnostics=diagnostics,
            stats=stats,
        )
        writings = to_writings_entries(posts, config)
        projects = to_project_entries(posts, config)
        write_outputs_atomically(writings, projects)
        stats.writings_entries = len(writings)
        stats.project_entries = len(projects)
        stats.outputs_written = 2
        emit_run_summary("success", stats, "Sync completed")
        return 0
    except (SyncRequestError, HTTPError, URLError, TimeoutError) as exc:
        emit_run_summary("failure", stats, str(exc))
        print(f"Substack sync failed due to network/API error: {exc}", file=sys.stderr)
        return 1
    except (KeyError, TypeError, ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
        emit_run_summary("failure", stats, str(exc))
        print(f"Substack sync failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
