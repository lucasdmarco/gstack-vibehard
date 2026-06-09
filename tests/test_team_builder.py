import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
TEAM_BUILDER = REPO_ROOT / "scripts" / "scripts" / "team_builder.py"


class TeamBuilderTest(unittest.TestCase):
    def test_producer_reviewer_returns_agent_team_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                [sys.executable, str(TEAM_BUILDER), "producer-reviewer"],
                cwd=tmp,
                capture_output=True,
                text=True,
                timeout=20,
            )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            data = json.loads(result.stdout)
            self.assertTrue(data["ok"])
            self.assertEqual(data["pattern"], "producer-reviewer")
            self.assertEqual(data["env"]["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"], "1")
            self.assertEqual(data["command"][0], "claude")
            self.assertIn("Producer-Reviewer", data["spawn_prompt"])
            self.assertIn("Lider", data["spawn_prompt"])
            self.assertIn("Frontend Specialist", data["spawn_prompt"])
            self.assertIn("QA Automation Engineer", data["spawn_prompt"])
            self.assertIn("Docker sandbox", data["spawn_prompt"])
            self.assertIn("revfactory/harness", data["spawn_prompt"])

    def test_pipeline_and_fanout_are_supported(self):
        for pattern in ["pipeline", "fan-out"]:
            with self.subTest(pattern=pattern):
                result = subprocess.run(
                    [sys.executable, str(TEAM_BUILDER), pattern],
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                data = json.loads(result.stdout)
                self.assertTrue(data["ok"])
                self.assertEqual(data["pattern"], pattern)
                self.assertIn("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1", data["instruction"])

    def test_invalid_pattern_returns_structured_json_error(self):
        result = subprocess.run(
            [sys.executable, str(TEAM_BUILDER), "unknown-pattern"],
            capture_output=True,
            text=True,
            timeout=20,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertFalse(data["ok"])
        self.assertIn("unsupported", data["error"].lower())
        self.assertIn("producer-reviewer", data["supported_patterns"])

    def test_extra_args_return_structured_json_error(self):
        result = subprocess.run(
            [sys.executable, str(TEAM_BUILDER), "producer-reviewer", "unexpected"],
            capture_output=True,
            text=True,
            timeout=20,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertFalse(data["ok"])
        self.assertIn("exactly one", data["error"].lower())


if __name__ == "__main__":
    unittest.main()
