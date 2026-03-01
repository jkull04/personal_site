import argparse
import contextlib
import io
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

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


def make_public_post(slug: str = "post-1") -> dict:
    return {
        "slug": slug,
        "title": f"Title {slug}",
        "post_date": "2026-03-01T00:00:00.000Z",
        "is_published": True,
        "audience": "everyone",
        "postTags": [{"name": "Essays"}],
        "body_html": "<p>hello</p>",
    }


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


class SourceFailoverTests(unittest.TestCase):
    @patch("scripts.sync_substack_content.fetch_posts_from_archive_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_posts_api")
    def test_fetch_posts_with_failover_uses_posts_source_when_available(self, mock_posts_api, mock_archive_api):
        mock_posts_api.return_value = [make_public_post("from-posts")]
        stats = sync.SyncStats()

        posts = sync.fetch_posts_with_failover(
            make_config(),
            source_order=["posts", "archive"],
            retries=3,
            timeout_seconds=2.0,
            diagnostics=False,
            stats=stats,
            min_public_posts=1,
        )

        self.assertEqual(posts[0]["slug"], "from-posts")
        self.assertEqual(stats.source_selected, "posts")
        self.assertFalse(stats.fallback_used)
        self.assertEqual(stats.public_posts, 1)
        mock_archive_api.assert_not_called()

    @patch("scripts.sync_substack_content.fetch_posts_from_archive_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_posts_api")
    def test_fetch_posts_with_failover_falls_back_to_archive(self, mock_posts_api, mock_archive_api):
        mock_posts_api.side_effect = sync.SyncRequestError("HTTP 503", transient=True)
        mock_archive_api.return_value = [make_public_post("from-archive")]
        stats = sync.SyncStats()

        posts = sync.fetch_posts_with_failover(
            make_config(),
            source_order=["posts", "archive"],
            retries=3,
            timeout_seconds=2.0,
            diagnostics=False,
            stats=stats,
            min_public_posts=1,
        )

        self.assertEqual(posts[0]["slug"], "from-archive")
        self.assertEqual(stats.source_selected, "archive")
        self.assertTrue(stats.fallback_used)
        self.assertEqual(len(stats.source_failures), 1)
        self.assertIn("posts:", stats.source_failures[0])

    @patch("scripts.sync_substack_content.fetch_posts_from_archive_api")
    @patch("scripts.sync_substack_content.fetch_posts_from_posts_api")
    def test_fetch_posts_with_failover_fails_when_all_sources_fail(self, mock_posts_api, mock_archive_api):
        mock_posts_api.side_effect = sync.SyncRequestError("HTTP 503", transient=True)
        mock_archive_api.side_effect = sync.SyncRequestError("HTTP 520", transient=True)
        stats = sync.SyncStats()

        with self.assertRaises(RuntimeError) as raised:
            sync.fetch_posts_with_failover(
                make_config(),
                source_order=["posts", "archive"],
                retries=3,
                timeout_seconds=2.0,
                diagnostics=False,
                stats=stats,
                min_public_posts=1,
            )

        self.assertIn("All sources failed", str(raised.exception))


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
            source_order="posts,archive",
            min_public_posts=1,
        )
        mock_load_config.return_value = make_config()

        exit_code = sync.main()

        self.assertEqual(exit_code, 1)
        mock_write_outputs.assert_not_called()
        mock_emit_run_summary.assert_called_once()


class SummaryTests(unittest.TestCase):
    @patch("scripts.sync_substack_content.write_step_summary")
    @patch("scripts.sync_substack_content.time.monotonic", return_value=1.0)
    def test_emit_run_summary_includes_source_and_fallback(self, _mock_time, _mock_write_step_summary):
        stats = sync.SyncStats(
            fetch_attempts=4,
            pages_fetched=1,
            posts_received=3,
            public_posts=3,
            writings_entries=2,
            project_entries=1,
            outputs_written=2,
            source_selected="archive",
            source_order="posts,archive",
            fallback_used=True,
            started_at=0.0,
        )

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            sync.emit_run_summary("success", stats, "Sync completed")

        logged = output.getvalue()
        self.assertIn("source='archive'", logged)
        self.assertIn("fallback_used=true", logged)


if __name__ == "__main__":
    unittest.main()
