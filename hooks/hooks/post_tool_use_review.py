#!/usr/bin/env python3
"""post_tool_use_review.py — GStack PostToolUse: roteador incremental limitado.

PRD36 36.2. ANTES rodava `npx fallow audit` COMPLETO a cada ferramenta — caro e
repetia o erro da v2.2.0 (checagem pesada por acao). AGORA: classifica o arquivo
tocado e RECOMENDA a checagem incremental certa (testes da area / typecheck /
evidencia de navegador / migration) — NUNCA a suite inteira nem o fallow completo.

Espelha classifyDiff/stepClose de src/skills/action-kernel.js (gstack.action-kernel.v1).
Honestidade: PostToolUse OBSERVA/REGISTRA (advisory) — a acao ja rodou, o hook nao
a desfaz. FAIL-OPEN: qualquer erro de parsing libera (exit 0), nunca trava o turno.
"""

import json
import re
import sys
from pathlib import Path

SCHEMA = "gstack.action-kernel.v1"

# Ordem = prioridade (o primeiro que casar define o tipo). Espelha DIFF_RULES.
DIFF_RULES = [
    ("migration", r"(^|[/\\])migrations[/\\]|\.sql$|schema\.prisma$"),
    ("frontend", r"\.(tsx|jsx|css|scss|vue|svelte)$|(^|[/\\])(components|pages|app)[/\\]"),
    ("backend", r"(^|[/\\])(api|server|routes)[/\\]|\.(controller|service|route)\.(t|j)s$"),
    ("test", r"\.(test|spec)\.(t|j)sx?$|(^|[/\\])tests?[/\\]"),
    ("config", r"\.(json|ya?ml|toml)$"),
    ("docs", r"\.(md|mdx|txt)$"),
]

# Checagem certa por tipo — testes SEMPRE incrementais (nunca a suite por edicao).
STEP_CHECKS = {
    "migration": ["migration-present", "db-smoke"],
    "frontend": ["incremental-tests", "visual-evidence"],
    "backend": ["incremental-tests", "typecheck"],
    "test": ["incremental-tests"],
    "config": ["typecheck", "command-lint"],
    "docs": ["command-lint"],
    "other": ["incremental-tests"],
}


def classify_file(path):
    for kind, pat in DIFF_RULES:
        if re.search(pat, path, re.IGNORECASE):
            return kind
    return "other"


def classify_diff(files):
    types = []
    for f in files:
        t = classify_file(f)
        if t not in types:
            types.append(t)
    order = [k for k, _ in DIFF_RULES] + ["other"]
    primary = next((t for t in order if t in types), "none")
    return types, primary


def dedupe(seq):
    out = []
    for x in seq:
        if x not in out:
            out.append(x)
    return out


def touched_files(inp):
    ti = inp.get("tool_input", {}) if isinstance(inp, dict) else {}
    candidates = [ti.get("file_path"), ti.get("path"), inp.get("file_path")]
    return [c for c in candidates if isinstance(c, str) and c]


def record_advisory(cwd, review):
    """Anexa advisory sanitizado ao ledger; fail-open (nunca levanta)."""
    try:
        d = Path(cwd) / ".gstack" / "events"
        d.mkdir(parents=True, exist_ok=True)
        with (d / "post-tool.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(review) + "\n")
    except Exception:
        pass


def main():
    try:
        inp = json.loads(sys.stdin.read())
    except Exception:
        sys.exit(0)  # FAIL-OPEN

    files = touched_files(inp)
    types, primary = classify_diff(files)
    checks = dedupe([c for t in (types or ["other"]) for c in STEP_CHECKS.get(t, STEP_CHECKS["other"])]) if files else []

    review = {
        "schemaVersion": SCHEMA,
        "event": "tool.after",
        "level": "advisory",
        "tool": inp.get("tool_name", "") if isinstance(inp, dict) else "",
        "files": files,
        "primary": primary,
        "checks": checks,
        "ranFullSuite": False,
        "note": "roteador incremental — checagem pelo tipo do diff; NUNCA a suite/fallow completo por acao",
    }

    cwd = inp.get("cwd", "") if isinstance(inp, dict) else ""
    if cwd and files:
        record_advisory(cwd, review)
    print(json.dumps(review))


if __name__ == "__main__":
    main()
