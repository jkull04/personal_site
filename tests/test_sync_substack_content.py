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
        mock_urlopen.side_effect = [http_error(url, 403, body=b"forbidden")]

        with self.assertRaises(sync.SyncRequestError) as raised:
            sync.fetch_json(url, retries=3, timeout_seconds=2.0)

        self.assertIn("HTTP 403", str(raised.exception))
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


if __name__ == "__main__":
    unittest.main()
