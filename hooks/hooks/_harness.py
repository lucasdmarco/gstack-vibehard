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
    return {
        "cwd": get_field(inp, "cwd") or "",
        "last_assistant_message": get_field(inp, "last_assistant_message", "lastMessage", "last_message") or "",
        "turn_id": get_field(inp, "turn_id", "turnNumber", "turnId") or "",
        "transcript_path": get_field(inp, "transcript_path", "transcriptPath") or "",
        "flags": get_field(inp, "flags") or {},
    }
