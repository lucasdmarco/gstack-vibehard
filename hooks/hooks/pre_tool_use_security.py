#!/usr/bin/env python3
"""PreToolUse hook: security guardrails + design system mandate.
Integrates Paperclip-inspired precondition enforcement:
  - Blocks dangerous commands (security)
  - Blocks Write/Edit on UI files if design system not configured (workflow mandate)
"""
import json, sys, re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _harness import emit_permission_decision, normalize_input

# FAIL-OPEN: este hook roda em TODO Write/Edit/Bash de TODO projeto. Input
# malformado/ausente NUNCA pode crashar e travar o turno do usuário — em qualquer
# erro de parsing, libera (exit 0). A segurança (BLOCK_PATTERNS) só age se o
# parsing der certo; um crash não deve "bloquear por acidente".
try:
    inp = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)
tool_input = inp.get("tool_input", {}) if isinstance(inp, dict) else {}
# Claude/Codex: tool_input.command | Cursor beforeShellExecution: command no top-level
cmd = tool_input.get("command", "") or inp.get("command", "")
# Write/Edit/apply_patch enviam file_path (nao command)
file_path = tool_input.get("file_path", "") or tool_input.get("path", "")
tool_name = inp.get("tool_name", "")
try:
    cwd = normalize_input(inp)["cwd"]
except Exception:
    cwd = ""

# ═══════════════════════════════════════════════════════
#  DESIGN SYSTEM MANDATE — Paperclip pre-tool gate pattern
#  Blocks Write/Edit of UI files if design system
#  has not been asked yet.
# ═══════════════════════════════════════════════════════
def check_design_system_mandate():
    """Return (blocked, reason) if Write/Edit targets UI files without DS."""
    if tool_name not in ("Write", "Edit", "apply_patch"):
        return False, ""

    # Only block for frontend file types — Write/Edit informam file_path
    target = file_path or ""
    if not target:
        return False, ""
    frontend_exts = (".tsx", ".jsx", ".css", ".html", ".vue", ".svelte")
    if not target.lower().endswith(frontend_exts):
        return False, ""

    # Find project root (look for .gstack/)
    search_dir = Path(cwd) if cwd else Path.cwd()
    session_file = None
    gstack_project = False
    for _ in range(5):
        if (search_dir / ".gstack").exists():
            gstack_project = True
            candidate = search_dir / ".gstack" / "session_state.json"
            if candidate.exists():
                session_file = candidate
            break
        parent = search_dir.parent
        if parent == search_dir:
            break
        search_dir = parent

    # So aplica o mandato em projetos gstack (.gstack/ presente) — bloquear
    # qualquer projeto do usuario sem opt-in seria hostil.
    if not gstack_project:
        return False, ""

    if not session_file:
        return True, (
            "BLOQUEADO: Este projeto nao tem configuracao de design system. "
            "Antes de escrever codigo de frontend, pergunte ao usuario: "
            "'Voce ja tem um design system proprio? (caminho da pasta com tokens, ou package npm)' "
            "Depois registre em .gstack/session_state.json com asked_about_design_system: true."
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
        emit_permission_decision(inp, "deny", reason)

# Design system mandate — só aplica em projeto gstack (.gstack/). Fail-open: se a
# checagem (que lê arquivos) der qualquer erro, NÃO bloqueia.
try:
    blocked, reason = check_design_system_mandate()
except Exception:
    blocked, reason = False, ""
if blocked:
    emit_permission_decision(inp, "deny", reason)

# ═══════════════════════════════════════════════════════
#  CHALLENGE-RESPONSE PRE-TOOL (VFA — PRD14 §6.4)
#  Ação de ALTO RISCO (config global de harness / comando
#  destrutivo desafiável) exige justificativa registrada:
#  `gstack_vibehard challenge evaluate --evidence ...` grava
#  um grant (recibo allow) que este gate honra por 15min.
#  Só age em projeto gstack; fail-open em QUALQUER erro.
# ═══════════════════════════════════════════════════════

# Alvos de escrita em config GLOBAL de harness (na home do usuário).
GLOBAL_CONFIG_RX = re.compile(
    r'[/\\]\.(claude|codex|cursor)[/\\]|[/\\]\.?(mcp|claude)\.json$|[/\\]\.config[/\\]opencode',
    re.IGNORECASE,
)
# Comandos desafiáveis (rm -rf/etc. já são hard-block acima; estes exigem evidência).
CHALLENGE_CMD_RX = re.compile(r'\bgit\s+push\s+--force\b|\bdrop\s+database\b', re.IGNORECASE)


def challenge_action_args():
    """Mapeia a tool call num action VFA de alto risco (args da CLI), ou None."""
    home = str(Path.home())
    if tool_name in ("Write", "Edit", "apply_patch") and file_path:
        p = str(Path(file_path))
        if p.startswith(home) and GLOBAL_CONFIG_RX.search(p):
            return ["--intent", "edit_file", "--target", p, "--scope", "global"]
    if cmd and CHALLENGE_CMD_RX.search(cmd):
        return ["--intent", "run_command", "--target", cmd[:200]]
    return None


def run_challenge_pretool(action_args, project_root):
    """Invoca `gstack_vibehard challenge pretool --json` (só no caso raro de alto risco)."""
    import shutil
    import subprocess
    exe = os.environ.get("GSTACK_CLI_BIN") or shutil.which("gstack_vibehard")
    if not exe:
        return None
    argv = [exe, "challenge", "pretool", *action_args, "--harness", "claude", "--json"]
    if exe.lower().endswith((".cmd", ".bat")):
        argv = ["cmd.exe", "/c"] + argv
    out = subprocess.run(argv, capture_output=True, text=True, timeout=20, cwd=str(project_root))
    lines = [l for l in (out.stdout or "").strip().splitlines() if l.strip()]
    return json.loads(lines[-1]) if lines else None


try:
    import os
    from _paths import find_gstack_root
    _root = find_gstack_root(cwd)
    if _root is not None:
        _args = challenge_action_args()
        if _args:
            _decision = run_challenge_pretool(_args, _root)
            if _decision and _decision.get("decision") == "deny":
                emit_permission_decision(
                    inp, "deny",
                    "CHALLENGE (VFA): acao de alto risco '%s' exige justificativa registrada. "
                    "Forneca a evidencia e tente de novo: %s"
                    % (_decision.get("rule", "?"), _decision.get("howTo", "gstack_vibehard challenge evaluate")),
                )
except Exception:
    pass  # fail-open: gate de challenge NUNCA trava o turno por erro proprio

# Allow
sys.exit(0)
