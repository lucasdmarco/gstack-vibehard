import json
import sys


def get_field(inp, *names):
    for name in names:
        val = inp.get(name)
        if val is not None:
            return val
    return None


def parse_stdin():
    try:
        raw = sys.stdin.read()
        if raw.strip():
            return json.loads(raw)
    except json.JSONDecodeError:
        pass
    return {}


def normalize_input(inp):
    # Cursor entrega cwd em workspace_roots[0]; Claude/Codex em cwd
    cwd = get_field(inp, "cwd") or ""
    if not cwd:
        roots = inp.get("workspace_roots")
        if isinstance(roots, list) and roots:
            cwd = roots[0]
    return {
        "cwd": cwd,
        "last_assistant_message": get_field(inp, "last_assistant_message", "lastMessage", "last_message") or "",
        "turn_id": get_field(inp, "turn_id", "turnNumber", "turnId") or "",
        "transcript_path": get_field(inp, "transcript_path", "transcriptPath") or "",
        "flags": get_field(inp, "flags") or {},
        "stop_hook_active": bool(get_field(inp, "stop_hook_active", "stopHookActive")),
    }


def detect_harness(inp):
    """Identifica o harness pelo formato do payload.

    Cursor inclui cursor_version em todos os hooks; Claude Code inclui
    session_id/hook_event_name sem cursor_version. Default: claude
    (formato hookSpecificOutput, tambem aceito pelo Codex bridge).
    """
    if "cursor_version" in inp:
        return "cursor"
    return "claude"


def emit_permission_decision(inp, decision, reason, event="PreToolUse"):
    """Emite a decisao de permissao no formato do harness detectado e encerra.

    decision: "deny" | "allow" | "ask"
    - Claude Code: {"hookSpecificOutput": {"permissionDecision": ...}} + exit 0
    - Cursor:      {"permission": ...} + exit 0 (exit 2 tambem bloquearia,
                   mas o JSON e mais informativo para o usuario)
    """
    harness = detect_harness(inp)
    if harness == "cursor":
        output = {
            "permission": decision,
            "user_message": reason,
            "agent_message": reason,
        }
    else:
        output = {
            "hookSpecificOutput": {
                "hookEventName": event,
                "permissionDecision": decision,
                "permissionDecisionReason": reason,
            }
        }
    sys.stdout.write(json.dumps(output))
    sys.exit(0)
