import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
STOP = REPO_ROOT / "hooks" / "hooks" / "stop.py"


class StopAudioCuesTest(unittest.TestCase):
    def run_stop(self, payload, home):
        env = os.environ.copy()
        env["GSTACK_AUDIO_CUES_TEST"] = "1"
        env["HOME"] = str(home)
        env["USERPROFILE"] = str(home)
        return subprocess.run(
            [sys.executable, str(STOP)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            timeout=20,
        )

    def test_success_audio_cue_keeps_stdout_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            root.mkdir()
            home.mkdir()
            (root / "package.json").write_text("{}\n", encoding="utf-8")

            result = self.run_stop({"cwd": str(root), "last_assistant_message": "ok", "flags": {}}, home)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("audio-cue:success", result.stderr)
            data = json.loads(result.stdout)
            self.assertIn("systemMessage", data)

    def test_failure_audio_cue_keeps_stdout_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            root.mkdir()
            home.mkdir()
            (root / "package.json").write_text("{}\n", encoding="utf-8")
            (root / "Dockerfile").write_text("FROM node:22\nCMD [\"npm\", \"run\", \"dev\"]\n", encoding="utf-8")

            result = self.run_stop({"cwd": str(root), "last_assistant_message": "deploy", "flags": {"security_gate": True}}, home)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("audio-cue:error", result.stderr)
            data = json.loads(result.stdout)
            self.assertIn("Security Gate: BLOQUEADO", data["systemMessage"])


if __name__ == "__main__":
    unittest.main()
