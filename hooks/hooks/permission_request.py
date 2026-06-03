#!/usr/bin/env python3
"""PermissionRequest hook: auto-approve safe commands."""
import json, sys, re

inp = json.loads(sys.stdin.read())
cmd = inp.get("tool_input", {}).get("command", "")

# Auto-approve safe commands
SAFE_PATTERNS = [
    r'^npm (run|test|build|dev|start|lint|typecheck)\b',
    r'^npx\s+tsx\b',
    r'^npx\s+vitest\b',
    r'^npx\s+playwright\b',
    r'^npm install\b',
    r'^git (status|diff|log|branch|add|commit|push|pull|checkout\s+-b)\b',
    r'^dir\b',
    r'^ls\b',
    r'^Get-ChildItem\b',
    r'^cat\b',
    r'^type\b',
    r'^echo\b',
    r'^pwd\b',
    r'^node\s',
    r'^python3?\s',
    r'^dx\s',
]

for pattern in SAFE_PATTERNS:
    if re.match(pattern, cmd.strip()):
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {"behavior": "allow"}
            }
        }
        sys.stdout.write(json.dumps(output))
        sys.exit(0)

# Don't decide - let normal approval flow handle it
sys.exit(0)
