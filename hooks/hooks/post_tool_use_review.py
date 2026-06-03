#!/usr/bin/env python3
"""PostToolUse hook: auto-review after code edits."""
import json, sys, os
from pathlib import Path

inp = json.loads(sys.stdin.read())

cwd = inp.get("cwd", "")
tool_name = inp.get("tool_name", "")
tool_input = inp.get("tool_input", {})
tool_response = inp.get("tool_response", {})

# Only review actual code changes
changes = []
if tool_name == "apply_patch" or "Edit" in tool_name or "Write" in tool_name:
    changes.append(tool_input.get("command", ""))

# Check if response has errors
has_error = False
response_str = json.dumps(tool_response).lower()
if "error" in response_str or "fail" in response_str or "not found" in response_str:
    has_error = True

# Check for common issues in the response/command
issues = []
for change in changes:
    if "import" in change and not change.strip().startswith("//") and not change.strip().startswith("#"):
        pass  # imports are fine
    if "console.log" in change or "print(" in change:
        pass  # debug logs are ok for now

if has_error:
    output = {
        "decision": "block",
        "reason": f"O tool call {tool_name} retornou um erro. Revise e corrija antes de continuar.",
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": f"Erro detectado em {tool_name}: {tool_response.get('error', 'unknown')}"
        }
    }
    sys.stdout.write(json.dumps(output))

sys.exit(0)
