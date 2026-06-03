#!/usr/bin/env python3
"""PreToolUse hook: security guardrails for Bash commands."""
import json, sys, re

inp = json.loads(sys.stdin.read())
cmd = inp.get("tool_input", {}).get("command", "")

# Block patterns
BLOCK_PATTERNS = [
    (r'\brm\s+-rf\s+[/\\](\s|$)', "rm -rf / bloqueado (destruiria o sistema)"),
    (r'\brm\s+-rf\s+~[/\\]', "rm -rf na home bloqueado"),
    (r'\brm\s+-rf\s+\$HOME[/\\]', "rm -rf na home bloqueado"),
    (r'\brm\s+-rf\s+--no-preserve-root\b', "rm --no-preserve-root bloqueado"),
    (r'\bchmod\s+-R\s+777\s+[/\\]', "chmod 777 / bloqueado"),
    (r'\bdangerously-bypass-hook-trust\b', "bypass de hooks bloqueado"),
    (r'\bwget\s+.+--no-check-certificate\b', "wget sem certificado bloqueado"),
    (r'\bcurl\s+.+-k\s', "curl sem certificado bloqueado"),
    (r'[|;]\s*(sh|bash|zsh)\s+-c\s+["\'](?:curl|wget)', "pipe para shell remoto bloqueado"),
]

for pattern, reason in BLOCK_PATTERNS:
    if re.search(pattern, cmd, re.IGNORECASE):
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason
            }
        }
        sys.stdout.write(json.dumps(output))
        sys.exit(0)

# Allow
sys.exit(0)
