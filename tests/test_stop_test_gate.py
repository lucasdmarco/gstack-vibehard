"""Test Gate: o Stop hook roda a suite de testes do projeto (paridade Replit)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
STOP = REPO_ROOT / "hooks" / "hooks" / "stop.py"


def run_stop(payload, home, extra_env=None):
    env = os.environ.copy()
    env["GSTACK_AUDIO_CUES_TEST"] = "1"  # audio silencioso
    env["HOME"] = str(home)
    env["USERPROFILE"] = str(home)
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, str(STOP)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )


def make_node_project(root, exit_code):
    """Projeto Node com test script que sai com exit_code."""
    root.mkdir(parents=True)
    (root / ".gstack").mkdir(exist_ok=True)  # projeto gstack: stop só roda com .gstack/
    (root / "package.json").write_text(json.dumps({
        "name": "fixture",
        "scripts": {"test": f"node -e \"process.exit({exit_code})\""},
    }), encoding="utf-8")


class StopTestGateTest(unittest.TestCase):
    def test_passing_suite_reports_ok(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            home.mkdir()
            make_node_project(root, 0)

            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "ok", "flags": {}},
                home,
                {"GSTACK_TEST_GATE": "1"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertIn("systemMessage", data)

    def test_failing_suite_blocks_when_gate_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            home.mkdir()
            make_node_project(root, 1)

            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "done", "flags": {}},
                home,
                {"GSTACK_TEST_GATE": "block"},
            )
            data = json.loads(result.stdout)
            self.assertEqual(data.get("decision"), "block")
            self.assertIn("Test Gate", data.get("reason", ""))

    def test_failing_suite_non_blocking_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            home.mkdir()
            make_node_project(root, 1)

            # GSTACK_TEST_GATE=1 forca rodar, mas sem "block" nao bloqueia o stop
            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "done", "flags": {}},
                home,
                {"GSTACK_TEST_GATE": "1"},
            )
            data = json.loads(result.stdout)
            self.assertNotEqual(data.get("decision"), "block")

    def test_block_respects_stop_hook_active(self):
        """Nao deve re-bloquear se ja estamos dentro de um stop hook (anti-loop)."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            home.mkdir()
            make_node_project(root, 1)

            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "done",
                 "flags": {}, "stop_hook_active": True},
                home,
                {"GSTACK_TEST_GATE": "block"},
            )
            data = json.loads(result.stdout)
            self.assertNotEqual(data.get("decision"), "block")

    def test_no_suite_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            root.mkdir()
            (root / ".gstack").mkdir(exist_ok=True)
            home.mkdir()
            # projeto sem package.json/tests — gate deve pular sem falhar

            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "ok", "flags": {}},
                home,
                {"GSTACK_TEST_GATE": "1"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertNotEqual(data.get("decision"), "block")


if __name__ == "__main__":
    unittest.main()
