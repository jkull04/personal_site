import argparse
import contextlib
import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from scripts import apply_substack_bridge_payload as bridge
from scripts import sync_substack_content as sync


class FakeResponse:
    def __init__(self, body: bytes, content_type: str, status: int = 200) -> None:
        self._body = body
        self.status = status
        self.headers = {"Content-Type": content_type}

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def http_error(url: str, code: int, body: bytes = b"") -> HTTPError:
    return HTTPError(url=url, code=code, msg="error", hdrs=None, fp=io.BytesIO(body))


def make_config() -> sync.SyncConfig:
    return sync.SyncConfig(
        publication_host="example.substack.com",
        writings_tag="Essays",
        blog_tag="Notes",
        projects_tag="Projects",
        required_sections=["Problem", "Approach", "Output"],
        optional_sections=["Tools", "Outcome"],
        page_limit=20,
        max_pages=5,
    )


def make_public_post(slug: str = "post-1", *, tags: list[str] | None = None, date: str = "2026-03-01T00:00:00.000Z") -> dict:
    tag_values = tags or ["Essays"]
    return {
        "slug": slug,
        "title": f"Title {slug}",
        "post_date": date,
        "is_published": True,
        "audience": "everyone",
        "postTags": [{"name": value} for value in tag_values],
        "body_html": "<h4>Problem</h4><p>P</p><h4>Approach</h4><p>A</p><h4>Output</h4><p>O</p>",
        "subtitle": "summary",
    }


def make_preload_page(post: dict) -> str:
    payload = {"post": post}
    encoded = json.dumps(json.dumps(payload))[1:-1]
    return f'<html><body><script>window._preloads = JSON.parse("{encoded}")</script></body></html>'


class FetchJsonTests(unittest.TestCase):
    @patch("scripts.sync_substack_content.time.sleep")
    @patch("scripts.sync_substack_content.urlopen")
    def test_fetch_json_returns_payload_on_200_json(self, mock_urlopen, _mock_sleep):
        mock_urlopen.return_value = FakeResponse(b'{"ok": true}', "application/json; charset=utf-8")

        payload = sync.fetch_json("https://example.com/posts?limit=2", retries=3, timeout_seconds=2.0)

        self.assertEqual(payload, {"ok": True})
        self.assertEqual(mock_urlopen.call_count, 1)

    @patch("scripts.sync_substack_content.time.sleep")
    @patch("scripts.sync_substack_content.urlopen")
    def test_fetch_json_retries_transient_http_and_succeeds(self, mock_urlopen, mock_sleep):
        url = "https://example.com/posts"
        mock_urlopen.side_effect = [
            http_error(url, 503, body=b"service unavailable"),
            FakeResponse(b'{"ok": true}', "application/json"),
        ]

        payload = sync.fetch_json(url, retries=3, timeout_seconds=2.0)

        self.assertEqual(payload, {"ok": True})
        self.assertEqual(mock_urlopen.call_count, 2)
        self.assertEqual(mock_sleep.call_count, 1)

    @patch("scripts.sync_substack_content.time.sleep")
    @patch("scripts.sync_substack_content.urlopen")
    def test_fetch_json_fail_fast_on_non_transient_http(self, mock_urlopen, mock_sleep):
        url = "https://example.com/posts"
        mock_urlopen.side_effect = [http_error(url, 404, body=b"not found")]

        with self.assertRaises(sync.SyncRequestError) as raised:
            sync.fetch_json(url, retries=3, timeout_seconds=2.0)

        self.assertIn("HTTP 404", str(raised.exception))
        self.assertEqual(mock_urlopen.call_count, 1)
        self.assertEqual(mock_sleep.call_count, 0)

    @patch("scripts.sync_substack_content.time.sleep")
    @patch("scripts.sync_substack_content.urlopen")
    def test_fetch_json_fails_on_non_json_content_type(self, mock_urlopen, mock_sleep):
        url = "https://example.com/posts"
        mock_urlopen.return_value = FakeResponse(b"<html>oops</html>", "text/html")

        with self.assertRaises(sync.SyncRequestError) as raised:
            sync.fetch_json(url, retries=1, timeout_seconds=2.0)

        self.assertIn("Unexpected content type", str(raised.exception))
        self.assertEqual(mock_urlopen.call_count, 1)
        self.assertEqual(mock_sleep.call_count, 0)

    @patch("scripts.sync_substack_content.time.sleep")
    @patch("scripts.sync_substack_content.urlopen")
    def test_fetch_json_retries_timeout_then_fails(self, mock_urlopen, mock_sleep):
        url = "https://example.com/posts"
        mock_urlopen.side_effect = [TimeoutError("timed out"), TimeoutError("timed out")]

        with self.assertRaises(sync.SyncRequestError) as raised:
            sync.fetch_json(url, retries=2, timeout_seconds=2.0)

        self.assertIn("Network error", str(raised.exception))
        self.assertEqual(mock_urlopen.call_count, 2)
        self.assertEqual(mock_sleep.call_count, 1)

    @patch("scripts.sync_substack_content.time.sleep")
    @patch("scripts.sync_substack_content.urlopen")
    def test_fetch_json_retries_cloudflare_520_then_succeeds(self, mock_urlopen, mock_sleep):
        url = "https://example.com/posts"
        mock_urlopen.side_effect = [
            http_error(url, 520, body=b"unknown error"),
            FakeResponse(b'{"ok": true}', "application/json"),
        ]

        payload = sync.fetch_json(url, retries=3, timeout_seconds=2.0)

        self.assertEqual(payload, {"ok": True})
        self.assertEqual(mock_urlopen.call_count, 2)
        self.assertEqual(mock_sleep.call_count, 1)


class FeedWebTests(unittest.TestCase):
    def test_extract_preloads_payload_parses_post(self):
        post = make_public_post("from-preload")
        page_html = make_preload_page(post)

        payload = sync._extract_preloads_payload(page_html, page_url="https://example.substack.com/p/from-preload")

        self.assertIn("post", payload)
        self.assertEqual(payload["post"]["slug"], "from-preload")

    @patch("scripts.sync_substack_content.fetch_text")
    def test_fetch_posts_from_feed_web_reads_feed_and_pages(self, mock_fetch_text):
        feed_xml = (
            "<?xml version='1.0' encoding='UTF-8'?>"
            "<rss><channel>"
            "<item><link>https://example.substack.com/p/a</link></item>"
            "<item><link>https://example.substack.com/p/b</link></item>"
            "</channel></rss>"
        )
        page_a = make_preload_page(make_public_post("a"))
        page_b = make_preload_page(make_public_post("b", tags=["Projects"]))
        mock_fetch_text.side_effect = [feed_xml, page_a, page_b]

        stats = sync.SyncStats()
        posts = sync.fetch_posts_from_feed_web(
            make_config(),
            retries=3,
            timeout_seconds=2.0,
            diagnostics=False,
            stats=stats,
        )

        self.assertEqual([post["slug"] for post in posts], ["a", "b"])
        self.assertEqual(stats.posts_received, 2)
        self.assertEqual(stats.pages_fetched, 3)  # feed + 2 post pages


class SourceFailoverTests(unittest.TestCase):
    @patch("scripts.sync_substack_content.fetch_posts_from_archive_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_posts_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_feed_web")
    def test_feed_web_success_short_circuits_fallback(self, mock_feed_web, mock_posts_api, mock_archive_api):
        mock_feed_web.return_value = [make_public_post("from-feed")]
        stats = sync.SyncStats()

        posts = sync.fetch_posts_with_failover(
            make_config(),
            source_order=["feed-web", "posts", "archive"],
            retries=3,
            timeout_seconds=2.0,
            diagnostics=False,
            stats=stats,
            min_public_posts=1,
        )

        self.assertEqual(posts[0]["slug"], "from-feed")
        self.assertEqual(stats.source_selected, "feed-web")
        self.assertFalse(stats.fallback_used)
        mock_posts_api.assert_not_called()
        mock_archive_api.assert_not_called()

    @patch("scripts.sync_substack_content.fetch_posts_from_archive_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_posts_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_feed_web")
    def test_feed_web_failure_falls_back_to_posts(self, mock_feed_web, mock_posts_api, mock_archive_api):
        mock_feed_web.side_effect = RuntimeError("feed unavailable")
        mock_posts_api.return_value = [make_public_post("from-posts")]
        stats = sync.SyncStats()

        posts = sync.fetch_posts_with_failover(
            make_config(),
            source_order=["feed-web", "posts", "archive"],
            retries=3,
            timeout_seconds=2.0,
            diagnostics=False,
            stats=stats,
            min_public_posts=1,
        )

        self.assertEqual(posts[0]["slug"], "from-posts")
        self.assertEqual(stats.source_selected, "posts")
        self.assertTrue(stats.fallback_used)
        self.assertEqual(len(stats.source_failures), 1)
        self.assertIn("feed-web:", stats.source_failures[0])
        mock_archive_api.assert_not_called()

    @patch("scripts.sync_substack_content.fetch_posts_from_archive_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_posts_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_feed_web")
    def test_fetch_posts_with_failover_fails_when_all_sources_fail(self, mock_feed_web, mock_posts_api, mock_archive_api):
        mock_feed_web.side_effect = RuntimeError("feed failure")
        mock_posts_api.side_effect = sync.SyncRequestError("HTTP 503", transient=True)
        mock_archive_api.side_effect = sync.SyncRequestError("HTTP 520", transient=True)
        stats = sync.SyncStats()

        with self.assertRaises(RuntimeError) as raised:
            sync.fetch_posts_with_failover(
                make_config(),
                source_order=["feed-web", "posts", "archive"],
                retries=3,
                timeout_seconds=2.0,
                diagnostics=False,
                stats=stats,
                min_public_posts=1,
            )

        self.assertIn("All sources failed", str(raised.exception))


class MergeTests(unittest.TestCase):
    def test_merge_entries_by_id_preserves_baseline_and_overrides_with_new(self):
        baseline = [
            {"id": "shared", "date": "2026-01-01", "title": "old"},
            {"id": "baseline-only", "date": "2025-12-31", "title": "keep"},
        ]
        fresh = [
            {"id": "shared", "date": "2026-03-01", "title": "new"},
            {"id": "fresh-only", "date": "2026-02-01", "title": "fresh"},
        ]

        merged = sync.merge_entries_by_id(fresh, baseline)
        by_id = {entry["id"]: entry for entry in merged}

        self.assertEqual(set(by_id.keys()), {"shared", "baseline-only", "fresh-only"})
        self.assertEqual(by_id["shared"]["title"], "new")
        self.assertEqual(merged[0]["id"], "shared")


class MainBehaviorTests(unittest.TestCase):
    @patch("scripts.sync_substack_content.emit_run_summary")
    @patch("scripts.sync_substack_content.write_outputs_atomically")
    @patch("scripts.sync_substack_content.to_project_entries", return_value=[])
    @patch("scripts.sync_substack_content.to_writings_entries", return_value=[])
    @patch("scripts.sync_substack_content.fetch_posts_with_failover", return_value=[])
    @patch("scripts.sync_substack_content.load_config")
    @patch("scripts.sync_substack_content.parse_args")
    def test_main_blocks_output_when_min_public_posts_not_met(
        self,
        mock_parse_args,
        mock_load_config,
        _mock_fetch_posts_with_failover,
        _mock_to_writings_entries,
        _mock_to_project_entries,
        mock_write_outputs,
        mock_emit_run_summary,
    ):
        mock_parse_args.return_value = argparse.Namespace(
            retries=3,
            timeout=20.0,
            diagnostics=False,
            input_file="",
            source_order="posts,feed-web,archive",
            min_public_posts=1,
            merge_baseline=True,
        )
        mock_load_config.return_value = make_config()

        exit_code = sync.main()

        self.assertEqual(exit_code, 1)
        mock_write_outputs.assert_not_called()
        mock_emit_run_summary.assert_called_once()


class BridgePayloadTests(unittest.TestCase):
    @patch("scripts.apply_substack_bridge_payload.sync.load_config")
    @patch("scripts.apply_substack_bridge_payload.sync.load_existing_outputs")
    def test_apply_post_replaces_same_id_and_clears_other_collection(self, mock_load_existing_outputs, mock_load_config):
        mock_load_config.return_value = make_config()
        mock_load_existing_outputs.return_value = (
            [{"id": "testing", "date": "2026-02-01", "title": "Old Essay"}],
            [{"id": "testing", "date": "2026-02-01", "title": "Old Project"}],
        )

        writings, projects = bridge.apply_post(make_public_post("testing", tags=["Essays"], date="2026-03-15T00:00:00.000Z"))

        self.assertEqual(writings[0]["id"], "testing")
        self.assertEqual(writings[0]["title"], "Title testing")
        self.assertFalse(any(item["id"] == "testing" for item in projects))

    def test_extract_post_from_event_supports_preload_html(self):
        post = make_public_post("from-bridge", tags=["Projects"])
        event = {
            "client_payload": {
                "page_url": "https://example.substack.com/p/from-bridge",
                "page_html": make_preload_page(post),
            }
        }

        extracted = bridge._extract_post_from_event(event)

        self.assertEqual(extracted["slug"], "from-bridge")


class SummaryTests(unittest.TestCase):
    @patch("scripts.sync_substack_content.write_step_summary")
    @patch("scripts.sync_substack_content.time.monotonic", return_value=1.0)
    def test_emit_run_summary_includes_source_and_fallback_and_result_mode(self, _mock_time, _mock_write_step_summary):
        stats = sync.SyncStats(
            fetch_attempts=4,
            pages_fetched=1,
            posts_received=3,
            public_posts=3,
            writings_entries=2,
            project_entries=1,
            outputs_written=2,
            source_selected="archive",
            source_order="posts,feed-web,archive",
            fallback_used=True,
            result_mode="merged_with_baseline",
            started_at=0.0,
        )

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            sync.emit_run_summary("success", stats, "Sync completed")

        logged = output.getvalue()
        self.assertIn("source='archive'", logged)
        self.assertIn("fallback_used=true", logged)
        self.assertIn("result_mode='merged_with_baseline'", logged)


if __name__ == "__main__":
    unittest.main()
