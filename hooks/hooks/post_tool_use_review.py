#!/usr/bin/env python3
"""post_tool_use_review.py — GStack: Automatic review after tool execution.

Analisa o resultado da última ferramenta executada e executa o quality gate
via fallow se aplicável.
"""

import json
import subprocess
import sys


def run_quality_gate():
    try:
        result = subprocess.run(
            ["npx", "fallow", "audit", "--format", "json"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout:
            return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
        pass
    return {"status": "skipped", "reason": "fallow not available"}


def main():
    result = run_quality_gate()
    print(json.dumps(result))


if __name__ == "__main__":
    main()
