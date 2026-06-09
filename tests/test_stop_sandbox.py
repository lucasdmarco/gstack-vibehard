import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
STOP = REPO_ROOT / "hooks" / "hooks" / "stop.py"


def write_fake_openhands(bin_dir: Path, exit_code: int) -> None:
    runner = bin_dir / "fake_openhands.py"
    runner.write_text(
        "import json, os, sys\n"
        "args_file = os.environ.get('OPENHANDS_ARGS_FILE')\n"
        "if args_file:\n"
        "    open(args_file, 'w', encoding='utf-8').write(json.dumps(sys.argv[1:]))\n"
        f"sys.exit({exit_code})\n",
        encoding="utf-8",
    )
    if os.name == "nt":
        (bin_dir / "openhands.cmd").write_text(
            "@echo off\r\n"
            f'"{sys.executable}" "{runner}" %*\r\n'
            "exit /b %ERRORLEVEL%\r\n",
            encoding="utf-8",
        )
    else:
        fake = bin_dir / "openhands"
        fake.write_text(
            "#!/usr/bin/env sh\n"
            f'exec "{sys.executable}" "{runner}" "$@"\n',
            encoding="utf-8",
        )
        fake.chmod(0o755)


class StopSandboxTest(unittest.TestCase):
    def run_stop(self, payload, home, bin_dir, extra_env=None, include_original_path=False):
        env = os.environ.copy()
        env["GSTACK_AUDIO_CUES_TEST"] = "1"
        env["GSTACK_SANDBOX_TEST"] = "1"
        env["HOME"] = str(home)
        env["USERPROFILE"] = str(home)
        env["PATH"] = str(bin_dir)
        if include_original_path:
            env["PATH"] += os.pathsep + os.environ.get("PATH", "")
        if extra_env:
            env.update(extra_env)
        return subprocess.run(
            [sys.executable, str(STOP)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            timeout=20,
        )

    def test_openhands_sandbox_failure_blocks_stop_with_json_and_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            bin_dir = Path(tmp) / "bin"
            args_file = Path(tmp) / "openhands_args.json"
            post_sprint_marker = Path(tmp) / "post_sprint_called.txt"
            root.mkdir()
            home.mkdir()
            bin_dir.mkdir()
            (root / "package.json").write_text("{}\n", encoding="utf-8")
            hooks_dir = home / ".codex" / "hooks"
            hooks_dir.mkdir(parents=True)
            (hooks_dir / "post_sprint.py").write_text(
                "import json\n"
                f"open({str(post_sprint_marker)!r}, 'w', encoding='utf-8').write('called')\n"
                "print(json.dumps({}))\n",
                encoding="utf-8",
            )
            write_fake_openhands(bin_dir, 7)

            result = self.run_stop(
                {"cwd": str(root), "last_assistant_message": "done", "flags": {}},
                home,
                bin_dir,
                {"OPENHANDS_ARGS_FILE": str(args_file)},
                include_original_path=True,
            )

            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("audio-cue:error", result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(data["error"], "OpenHands sandbox failed")
            self.assertEqual(data["exitStatus"], 1)
            self.assertIn("Sandbox OpenHands: FALHOU", data["systemMessage"])
            self.assertFalse(post_sprint_marker.exists(),
                             "sandbox failure must short-circuit post_sprint/QG python calls")
            openhands_args = json.loads(args_file.read_text(encoding="utf-8"))
            self.assertEqual(openhands_args, [
                "--headless",
                "-t",
                "Validar entrega e executar testes",
                "--path",
                str(root.resolve()),
            ])

    def test_missing_openhands_reports_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            bin_dir = Path(tmp) / "bin"
            root.mkdir()
            home.mkdir()
            bin_dir.mkdir()
            (root / "package.json").write_text("{}\n", encoding="utf-8")

            result = self.run_stop({"cwd": str(root), "last_assistant_message": "done", "flags": {}}, home, bin_dir)

            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("audio-cue:error", result.stderr)
            data = json.loads(result.stdout)
            self.assertIn("OpenHands sandbox failed", data["error"])


if __name__ == "__main__":
    unittest.main()
