import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
QG = REPO_ROOT / "hooks" / "hooks" / "qg.py"


class FallowWrapperTest(unittest.TestCase):
    def test_filters_auto_fixable_findings_and_exits_one_on_failed_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            fake_bin = tmp_path / "bin"
            fake_bin.mkdir()
            fallow_payload = {
                "verdict": "fail",
                "issues": [
                    {
                        "rule": "crap-complexity",
                        "title": "CRAP complexity too high",
                        "file": "src/billing.ts",
                        "severity": "high",
                        "auto_fixable": True,
                        "fix": "Extract nested branches",
                    },
                    {
                        "rule": "style-only",
                        "title": "Formatting preference",
                        "file": "src/ui.ts",
                        "severity": "low",
                        "auto_fixable": False,
                    },
                ],
            }

            fake_runner = fake_bin / "fake_npx_runner.py"
            fake_runner.write_text(
                "import json, sys\n"
                f"print(json.dumps({repr(fallow_payload)}))\n"
                "sys.exit(1)\n",
                encoding="utf-8",
            )

            if os.name == "nt":
                fake_npx = fake_bin / "npx.cmd"
                fake_npx.write_text(
                    "@echo off\r\n"
                    f"\"{sys.executable}\" \"{fake_runner}\" %*\r\n"
                    "exit /b %ERRORLEVEL%\r\n",
                    encoding="utf-8",
                )
            else:
                fake_npx = fake_bin / "npx"
                fake_npx.write_text(
                    "#!/usr/bin/env sh\n"
                    f"exec \"{sys.executable}\" \"{fake_runner}\" \"$@\"\n",
                    encoding="utf-8",
                )
                fake_npx.chmod(0o755)

            env = os.environ.copy()
            env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")

            result = subprocess.run(
                [sys.executable, str(QG), "--path", str(tmp_path), "--level", "1"],
                capture_output=True,
                text=True,
                env=env,
                timeout=15,
            )

            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            data = json.loads(result.stdout)
            self.assertFalse(data["pass"])
            self.assertEqual(data["engine"], "fallow")
            self.assertEqual(data["command"], ["npx", "fallow", "audit", "--format", "json"])
            self.assertEqual(len(data["issues"]), 1)
            self.assertEqual(data["issues"][0]["rule"], "crap-complexity", result.stdout + result.stderr)
            self.assertTrue(data["issues"][0]["auto_fixable"])

    def test_fallow_unavailable_skips_without_blocking(self):
        """Fallow e dependencia opcional — ausente, o QG deve PULAR (pass), nao
        bloquear criticamente."""
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env["PATH"] = tmp  # sem npx/node no PATH -> fallow indisponivel
            result = subprocess.run(
                [sys.executable, str(QG), "--path", tmp, "--level", "1"],
                capture_output=True, text=True, env=env, timeout=20,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            data = json.loads(result.stdout)
            self.assertTrue(data["pass"])
            self.assertEqual(data["verdict"], "skipped")


if __name__ == "__main__":
    unittest.main()
