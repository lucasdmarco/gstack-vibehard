#!/usr/bin/env python3
"""before_shell.py — GStack: Security check before shell execution.

Verifica se o comando a ser executado contém padrões perigosos como
pipe-to-shell (| sh, | bash, | iex) ou curl|sh sem validação.
"""

import json
import re
import sys

DANGEROUS_PATTERNS = [
    re.compile(r'\bcurl\s+\S+\s*\|\s*(?:sh|bash)\b', re.IGNORECASE),
    re.compile(r'\bwget\s+\S+\s*\|\s*(?:sh|bash)\b', re.IGNORECASE),
    re.compile(r'\birm\s+\S+\s*\|\s*iex\b', re.IGNORECASE),
    re.compile(r'\biwr\s+\S+\s*\|\s*iex\b', re.IGNORECASE),
]


def check_command(command: str) -> dict:
    issues = []
    for pattern in DANGEROUS_PATTERNS:
        if pattern.search(command):
            issues.append({
                "pattern": pattern.pattern,
                "severity": "HIGH",
                "message": "Pipe-to-shell pattern detected. Use safeDownloadAndRun() instead.",
            })
    return {
        "allowed": len(issues) == 0,
        "issues": issues,
    }


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        command = payload.get("command", "")
    except (json.JSONDecodeError, AttributeError):
        command = " ".join(sys.argv[1:])

    result = check_command(command)
    if not result["allowed"]:
        print(json.dumps(result))
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
