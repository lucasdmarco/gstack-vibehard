import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_MANAGER = REPO_ROOT / "scripts" / "scripts" / "workspace_manager.py"


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=30)


class WorkspaceManagerTest(unittest.TestCase):
    def test_create_worktree_and_copy_worktreeinclude_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            repo.mkdir()

            self.assertEqual(run(["git", "init"], repo).returncode, 0)
            self.assertEqual(run(["git", "config", "user.email", "test@example.com"], repo).returncode, 0)
            self.assertEqual(run(["git", "config", "user.name", "Test User"], repo).returncode, 0)

            (repo / "README.md").write_text("# repo\n", encoding="utf-8")
            (repo / ".env").write_text("TOKEN=secret\n", encoding="utf-8")
            (repo / "config").mkdir()
            (repo / "config" / "local.secret").write_text("db=password\n", encoding="utf-8")
            (repo / ".worktreeinclude").write_text(".env\nconfig/*.secret\n", encoding="utf-8")

            self.assertEqual(run(["git", "add", "README.md", ".worktreeinclude"], repo).returncode, 0)
            self.assertEqual(run(["git", "commit", "-m", "init"], repo).returncode, 0)

            result = subprocess.run(
                [sys.executable, str(WORKSPACE_MANAGER), "create", "feature-api", "--repo", str(repo)],
                capture_output=True,
                text=True,
                timeout=30,
            )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            worktree = repo / ".claude" / "worktrees" / "feature-api"
            self.assertTrue(worktree.exists())
            self.assertEqual((worktree / ".env").read_text(encoding="utf-8"), "TOKEN=secret\n")
            self.assertEqual((worktree / "config" / "local.secret").read_text(encoding="utf-8"), "db=password\n")
            self.assertIn("feature-api", result.stdout)


if __name__ == "__main__":
    unittest.main()
