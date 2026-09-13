from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts import refresh_substack_local as refresh


class LocalRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.origin = self.root / "origin.git"
        self.working = self.root / "working"
        subprocess.run(["git", "init", "--bare", str(self.origin)], check=True, capture_output=True)
        subprocess.run(["git", "init", "-b", "main", str(self.working)], check=True, capture_output=True)
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@localhost")
        (self.working / "scripts").mkdir()
        (self.working / "data").mkdir()
        for name in refresh.CONTENT_PATHS:
            (self.working / name).write_text("[]\n")
        (self.working / "index.html").write_text("original homepage")
        self.script = self.working / "scripts/sync_substack_content.py"
        self.script.write_text(
            "from pathlib import Path\n"
            "Path('data/writings.json').write_text('[{\"id\":\"fresh\"}]\\n')\n"
            "Path('index.html').write_text('must not be published')\n"
        )
        self.git("add", ".")
        self.git("commit", "-m", "Initial site")
        self.git("remote", "add", "origin", str(self.origin))
        self.git("push", "-u", "origin", "main")

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.working, check=True, text=True, capture_output=True
        ).stdout.strip()

    def remote_head(self):
        return self.git("ls-remote", "origin", "refs/heads/main").split()[0]

    def test_publishes_only_content_and_leaves_working_edits_alone(self):
        (self.working / "index.html").write_text("unfinished local edits")
        self.assertTrue(refresh.refresh(str(self.origin), publish=True))
        self.git("fetch", "origin")
        self.assertEqual(self.git("show", "origin/main:index.html"), "original homepage")
        self.assertIn('"fresh"', self.git("show", "origin/main:data/writings.json"))
        self.assertEqual((self.working / "index.html").read_text(), "unfinished local edits")
        first_head = self.remote_head()
        self.assertFalse(refresh.refresh(str(self.origin), publish=True))
        self.assertEqual(first_head, self.remote_head())

    def test_preview_does_not_push(self):
        before = self.remote_head()
        self.assertTrue(refresh.refresh(str(self.origin)))
        self.assertEqual(before, self.remote_head())

    def test_failed_sync_does_not_publish_partial_output(self):
        with self.script.open("a") as handle:
            handle.write("raise SystemExit(1)\n")
        self.git("add", "scripts/sync_substack_content.py")
        self.git("commit", "-m", "Simulate failed fetch")
        self.git("push")
        before = self.remote_head()
        with self.assertRaises(subprocess.CalledProcessError):
            refresh.refresh(str(self.origin), publish=True)
        self.assertEqual(before, self.remote_head())
