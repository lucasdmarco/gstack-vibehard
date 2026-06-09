#!/usr/bin/env python3
"""gstack_vibehard — Diagnóstico do ecossistema no início da sessão.

Lê e valida:
  .gstack/config.json     → stack + infra + versões
  .graphify/deps.json    → topologia do monorepo
  .context7/stack.json    → documentação da stack
  $HOME/.mom/mom.db       → memórias (MOM Windows-incompatível — fallback chronicle)
  ~/.codex/chronicle/     → índice de busca com memórias relevantes

Uso:
  python gc.py --path <projeto>

Retorno (stdout): JSON com diagnóstico completo.
"""
import json, os, subprocess, sqlite3, sys, glob
from pathlib import Path
from datetime import datetime

from _paths import chronicle_dir


def read_json(path: Path) -> dict | None:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
    return None


def detect_mode(stack: list) -> str:
    """Detecta se o projeto é frontend-only ou full-stack baseado na stack."""
    backend = {"express", "fastify", "hono", "nestjs", "elysia", "postgresql",
               "supabase", "neon", "turso", "prisma", "drizzle"}
    stack_set = set(s.lower() for s in stack)
    if stack_set & backend:
        return "full-stack"
    return "frontend-only"


def check_gstack(root: Path) -> dict:
    """Lê .gstack/config.json."""
    cfg = read_json(root / ".gstack" / "config.json")
    if not cfg:
        return {"present": False, "error": ".gstack/config.json não encontrado"}
    return {
        "present": True,
        "project": cfg.get("project", root.name),
        "variant": cfg.get("variant", "unknown"),
        "stack": cfg.get("stack", []),
        "infra": cfg.get("infra", {}),
        "api_dir": cfg.get("api_dir", ""),
        "db_package": cfg.get("db_package", ""),
        "mode": detect_mode(cfg.get("stack", [])),
        "tools": cfg.get("tools", []),
    }


def check_graphify(root: Path) -> dict:
    """Lê .graphify/deps.json — mapa de dependências."""
    deps = read_json(root / ".graphify" / "deps.json")
    if not deps:
        return {"present": False, "error": ".graphify/deps.json não encontrado"}
    nodes = deps.get("nodes", [])
    edges = deps.get("edges", [])
    return {
        "present": True,
        "nodes": [n.get("id") for n in nodes],
        "edges": [f"{e.get('from')}→{e.get('to')}" for e in edges],
        "topology": [f"{n.get('id')}({n.get('type','?')})" for n in nodes],
    }


def check_context7(root: Path) -> dict:
    """Lê .context7/stack.json."""
    ctx = read_json(root / ".context7" / "stack.json")
    if not ctx:
        return {"present": False, "error": ".context7/stack.json não encontrado"}
    return {"present": True, "stack": ctx}


def check_mom(root: Path) -> dict:
    """Tenta acessar $HOME/.mom/mom.db para recall de memórias."""
    mom_db = Path.home() / ".mom" / "mom.db"
    if not mom_db.exists():
        return {"present": False, "error": "MOM não instalado (mom.db não encontrado)"}

    try:
        conn = sqlite3.connect(str(mom_db))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        # Tabelas comuns do MOM
        tables = cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        table_names = [t["name"] for t in tables]

        memories = []
        if "memories" in table_names:
            rows = cursor.execute(
                "SELECT content, created_at FROM memories ORDER BY created_at DESC LIMIT 5"
            ).fetchall()
            memories = [
                {"content": r["content"][:200], "created_at": r["created_at"]}
                for r in rows
            ]
        elif "drafts" in table_names:
            rows = cursor.execute(
                "SELECT content, created_at FROM drafts ORDER BY created_at DESC LIMIT 5"
            ).fetchall()
            memories = [
                {"content": r["content"][:200], "created_at": r["created_at"]}
                for r in rows
            ]

        # Filtrar memórias que mencionam o projeto
        project_name = root.name.lower()
        relevant = [
            m for m in memories
            if project_name in m.get("content", "").lower()
        ] if memories else []

        conn.close()
        return {
            "present": True,
            "total_memories": len(memories),
            "project_relevant": len(relevant),
            "recent": [m["content"] for m in relevant[:3]] if relevant else [],
            "tables": table_names,
        }
    except (sqlite3.Error, ModuleNotFoundError) as e:
        return {"present": True, "error": str(e), "tables": []}


def build_chronicle_index():
    """Constrói índice de busca sobre todos os arquivos chronicle."""
    cdir = chronicle_dir()
    if not cdir.exists():
        return []
    entries = []
    for f in sorted(cdir.glob("*.md"), key=os.path.getmtime, reverse=True):
        text = f.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        project = ""
        summary = ""
        cwd = ""
        for line in lines:
            if line.startswith("# Session:"):
                project = line.replace("# Session:", "").strip()
            elif line.startswith("- Working directory:"):
                cwd = line.replace("- Working directory:", "").strip()
        in_summary = False
        summary_lines = []
        for line in lines:
            if line.strip() == "## Summary":
                in_summary = True
                continue
            if line.startswith("## "):
                in_summary = False
            if in_summary and line.strip():
                summary_lines.append(line.strip())
        summary = " ".join(summary_lines)[:500]
        entries.append({
            "file": f.name,
            "project": project,
            "cwd": cwd,
            "summary": summary,
            "mtime": f.stat().st_mtime,
        })
    return entries


def search_chronicle(index, query: str, limit: int = 3):
    """Busca no índice por termo (case-insensitive, substring)."""
    q = query.lower()
    scored = []
    for e in index:
        score = 0
        if q in e["project"].lower():
            score += 3
        if q in e["summary"].lower():
            score += 2
        if q in e["cwd"].lower():
            score += 1
        if score > 0:
            scored.append((score, e))
    scored.sort(key=lambda x: (-x[0], -x[1]["mtime"]))
    return [e for _, e in scored[:limit]]


def check_chronicle(root: Path) -> dict:
    """Lê índice do chronicle e busca memórias relevantes ao projeto."""
    index = build_chronicle_index()
    if not index:
        return {"present": False, "error": "chronicle dir não encontrado ou vazio"}

    project_name = root.name
    hits = search_chronicle(index, project_name, limit=3)
    return {
        "present": True,
        "total_notes": len(index),
        "relevant_hits": len(hits),
        "last_session": {
            "file": index[0]["file"],
            "project": index[0]["project"],
            "summary": index[0]["summary"],
        },
        "related": [
            {"file": h["file"], "project": h["project"], "summary": h["summary"][:200]}
            for h in hits
        ],
    }


def main():
    if len(sys.argv) < 3 or "--path" not in sys.argv:
        result = {"error": "Uso: python gc.py --path <projeto>"}
        print(json.dumps(result))
        sys.exit(1)

    path_idx = sys.argv.index("--path") + 1
    if path_idx >= len(sys.argv):
        result = {"error": "--path requer um argumento"}
        print(json.dumps(result))
        sys.exit(1)

    root = Path(sys.argv[path_idx]).resolve()
    if not root.exists():
        result = {"error": f"Path not found: {root}"}
        print(json.dumps(result))
        sys.exit(1)

    project = root.name

    # Executar todos os checks
    gstack = check_gstack(root)
    graphify = check_graphify(root)
    context7 = check_context7(root)
    mom = check_mom(root)
    chronicle = check_chronicle(root)

    # Montar diagnóstico
    mode = gstack.get("mode", "unknown") if gstack.get("present") else "unknown"
    stack_str = ", ".join(gstack.get("stack", [])) if gstack.get("stack") else "n/a"
    infra_str = ", ".join(
        f"{k}→{v}" for k, v in gstack.get("infra", {}).items()
    ) if gstack.get("infra") else "n/a"

    topo_str = "; ".join(graphify.get("topology", [])) if graphify.get("topology") else "n/a"
    edges_str = "; ".join(graphify.get("edges", [])) if graphify.get("edges") else "n/a"

    mom_recall = ""
    if mom.get("present") and mom.get("recent"):
        mom_recall = " | ".join(m["content"] for m in mom["recent"])

    chronicle_summary = ""
    if chronicle.get("present"):
        last = chronicle.get("last_session", {})
        chronicle_summary = f"Última: {last.get('project', '?')} — {last.get('summary', '')[:300]}"
        related = chronicle.get("related", [])
        if related:
            rel_lines = [f"  - {r['project']}: {r['summary'][:200]}" for r in related]
            chronicle_summary += "\nRelacionadas:\n" + "\n".join(rel_lines)

    # Diagnóstico legível
    variant = gstack.get("variant", "") if gstack.get("present") else ""
    api_dir = gstack.get("api_dir", "") if gstack.get("present") else ""
    db_pkg = gstack.get("db_package", "") if gstack.get("present") else ""
    ctx_lines = [
        f"=== gc.py: Diagnóstico do Projeto ===",
        f"Projeto: {project}",
        f"GStack: {'✓' if gstack.get('present') else '✗'}",
        f"  Stack: {stack_str}",
        f"  Infra: {infra_str}",
        f"  Variante: {variant}",
        f"  API: {api_dir}",
        f"  DB: {db_pkg}",
        f"  Modo: {mode.upper()}",
        f"Graphify: {'✓' if graphify.get('present') else '✗'}",
        f"  Topologia: {topo_str}",
        f"  Dependências: {edges_str}",
        f"Context7: {'✓' if context7.get('present') else '✗'}",
        f"MOM: {'✗ (não instalado — macOS only)' if not mom.get('present') else '✓'}",
        f"Chronicle: {'✓' if chronicle.get('present') else '✗'}",
    ]
    if mom_recall:
        ctx_lines.append(f"MOM Recall: {mom_recall[:300]}")
    if chronicle_summary:
        ctx_lines.append(f"Última sessão: {chronicle_summary[:300]}")

    diagnostic_text = "\n".join(ctx_lines)

    result = {
        "project": project,
        "mode": mode,
        "stack": gstack.get("stack", []),
        "infra": gstack.get("infra", {}),
        "topology": graphify.get("topology", []),
        "edges": graphify.get("edges", []),
        "graphify": graphify,
        "context7": context7,
        "mom": mom,
        "chronicle": chronicle,
        "diagnostic_text": diagnostic_text,
    }

    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
