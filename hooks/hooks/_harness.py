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


# ── Surrogates soltos ──────────────────────────────────────────────────────
# O transcript pode trazer UTF-16 malformado, e um surrogate isolado (`\ud83d`
# sem par) NAO e codificavel em UTF-8. Escrever um desses -- em arquivo, stdout
# ou stderr -- levanta `UnicodeEncodeError: surrogates not allowed`.
#
# ISSO JA ACONTECEU, com o hook OFICIAL de Stop rodando: um caractere invalido
# derrubou o hook e a memoria da sessao INTEIRA foi perdida. Um caractere nao
# pode custar a sessao.
#
# `surrogatepass` -> `replace` e a unica combinacao que atravessa: codifica o
# surrogate para bytes, e decodifica trocando por U+FFFD. Assim o texto CHEGA,
# com uma marca visivel de que algo veio corrompido, em vez de sumir.
SUBSTITUTO = "\ufffd"


def sem_surrogates(texto):
    """Texto codificavel em UTF-8, trocando surrogate solto por U+FFFD."""
    if not isinstance(texto, str):
        return texto
    try:
        texto.encode("utf-8")
        return texto
    except UnicodeEncodeError:
        return texto.encode("utf-8", "surrogatepass").decode("utf-8", "replace")


def escrita_segura(fluxo, texto):
    """Escreve tolerando surrogate. Nunca levanta -- e o ponto."""
    try:
        fluxo.write(sem_surrogates(texto))
    except Exception:
        # Ultimo recurso: ASCII puro. Perder acento e melhor que perder a sessao.
        try:
            fluxo.write(str(texto).encode("ascii", "replace").decode("ascii"))
        except Exception:
            pass
