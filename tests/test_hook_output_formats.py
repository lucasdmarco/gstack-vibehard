"""Camada de saida por harness: Claude (hookSpecificOutput) vs Cursor (permission)."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
HOOK = REPO_ROOT / "hooks" / "hooks" / "pre_tool_use_security.py"


def run_hook(payload):
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=20,
    )


class HookOutputFormatsTest(unittest.TestCase):
    def test_claude_payload_gets_hook_specific_output(self):
        result = run_hook({
            "tool_name": "Bash",
            "tool_input": {"command": "rm -rf /"},
            "cwd": "C:/tmp",
            "hook_event_name": "PreToolUse",
        })
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertNotIn("permission", data)

    def test_cursor_payload_gets_permission_format(self):
        result = run_hook({
            "hook_event_name": "beforeShellExecution",
            "cursor_version": "1.7.0",
            "command": "rm -rf /",
            "workspace_roots": ["C:/tmp"],
        })
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["permission"], "deny")
        self.assertIn("user_message", data)
        self.assertNotIn("hookSpecificOutput", data)

    def test_cursor_safe_command_is_allowed_silently(self):
        result = run_hook({
            "hook_event_name": "beforeShellExecution",
            "cursor_version": "1.7.0",
            "command": "npm test",
            "workspace_roots": ["C:/tmp"],
        })
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
