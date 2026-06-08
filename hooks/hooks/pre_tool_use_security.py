#!/usr/bin/env python3
"""PreToolUse hook: security guardrails + design system mandate.
Integrates Paperclip-inspired precondition enforcement:
  - Blocks dangerous commands (security)
  - Blocks Write/Edit on UI files if design system not configured (workflow mandate)
"""
import json, sys, re
from pathlib import Path

inp = json.loads(sys.stdin.read())
cmd = inp.get("tool_input", {}).get("command", "")
tool_name = inp.get("tool_name", "")
cwd = inp.get("cwd", "")

# ═══════════════════════════════════════════════════════
#  DESIGN SYSTEM MANDATE — Paperclip pre-tool gate pattern
#  Blocks Write/Edit of UI files if design system
#  has not been asked yet.
# ═══════════════════════════════════════════════════════
def check_design_system_mandate():
    """Return (blocked, reason) if Write/Edit targets UI files without DS."""
    if tool_name not in ("Write", "Edit", "apply_patch"):
        return False, ""

    # Only block for frontend file types
    target = cmd or ""
    frontend_patterns = [
        r'\.tsx["\']?\s*$', r'\.jsx["\']?\s*$', r'\.css["\']?\s*$',
        r'\.html["\']?\s*$', r'\.vue["\']?\s*$', r'\.svelte["\']?\s*$',
    ]
    is_frontend = False
    for pat in frontend_patterns:
        if re.search(pat, target, re.IGNORECASE):
            is_frontend = True
            break

    if not is_frontend:
        return False, ""

    # Find project root (look for .gstack/)
    search_dir = Path(cwd) if cwd else Path.cwd()
    session_file = None
    for _ in range(5):
        candidate = search_dir / ".gstack" / "session_state.json"
        if candidate.exists():
            session_file = candidate
            break
        parent = search_dir.parent
        if parent == search_dir:
            break
        search_dir = parent

    if not session_file:
        # No session state yet — block until project is initialized
        return True, (
            "BLOQUEADO: Este projeto nao tem configuracao de design system. "
            "Antes de escrever codigo de frontend, pergunte ao usuario: "
            "'Voce ja tem um design system proprio? (caminho da pasta com tokens, ou package npm)'"
        )

    try:
        state = json.loads(session_file.read_text(encoding="utf-8"))
        if state.get("asked_about_design_system"):
            return False, ""
        return True, (
            "BLOQUEADO: Design system nao configurado. "
            "Voce PERGUNTOU ao usuario se ele tem um design system? "
            "Se nao, pergunte antes de escrever qualquer codigo de frontend. "
            "Se ele disse 'nao', configure em .gstack/session_state.json "
            "com asked_about_design_system: true e design_system_engine definida."
        )
    except (json.JSONDecodeError, OSError):
        return True, (
            "BLOQUEADO: session_state.json corrompido ou inacessivel. "
            "Recrie com asked_about_design_system: true/false."
        )


# ═══════════════════════════════════════════════════════
#  SECURITY GUARDRAILS (existing)
# ═══════════════════════════════════════════════════════

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

# Design system mandate check (runs after security check)
blocked, reason = check_design_system_mandate()
if blocked:
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
