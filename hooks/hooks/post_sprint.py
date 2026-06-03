#!/usr/bin/env python3
"""post_sprint.py — Atualiza ferramentas de memoria ao final de cada sprint/fase.

Integra:
  1. graphify update  → re-escaneia src/ e atualiza .graphify/deps.json
  2. gbrain update    → extrai decisoes, adiciona em .gbrain/context.json
  3. MOM record       → salva resumo no MOM (apenas macOS)
  4. chronicle enrich → adiciona decisoes + grafos no chronicle

Chamado por: stop.py (hook on_stop)
Trigger manual: gstack_vibehard sprint --save
"""
import json, sys, os, subprocess, re
from pathlib import Path
from datetime import datetime


def update_graphify(root: Path, last_msg: str) -> dict:
    """Re-escaneia apps/ e packages/ para atualizar .graphify/deps.json."""
    graphify_dir = root / ".graphify"
    graphify_dir.mkdir(parents=True, exist_ok=True)

    nodes = []
    edges = []
    for subdir in ["apps", "packages"]:
        d = root / subdir
        if d.exists():
            for entry in sorted(d.iterdir()):
                if entry.is_dir() and not entry.name.startswith("."):
                    pkg_json = entry / "package.json"
                    deps = []
                    if pkg_json.exists():
                        try:
                            pkg = json.loads(pkg_json.read_text())
                            deps = list(pkg.get("dependencies", {}).keys())[:10]
                        except:
                            pass
                    type_map = {"apps": "app", "packages": "lib"}
                    nodes.append({
                        "id": f"{subdir}/{entry.name}",
                        "type": type_map.get(subdir, "unknown"),
                        "deps": deps,
                        "devDeps": [],
                        "updatedAt": datetime.now().isoformat()
                    })

    for node in nodes:
        for dep in node["deps"]:
            for pkg_node in nodes:
                if dep in pkg_node["id"] or pkg_node["id"].endswith(f"/{dep}"):
                    edges.append({"from": node["id"], "to": pkg_node["id"]})

    deps = {"nodes": nodes, "edges": edges, "updatedAt": datetime.now().isoformat()}
    (graphify_dir / "deps.json").write_text(json.dumps(deps, indent=2, ensure_ascii=False))

    # Mermaid graph HTML
    mermaid_lines = ["graph TD"]
    for n in nodes:
        safe_id = n["id"].replace("/", "_").replace("-", "_").replace(".", "_")
        mermaid_lines.append(f"  {safe_id}[\"{n['id']} - {n['type']}\"]")
    for e in edges:
        from_safe = e["from"].replace("/", "_").replace("-", "_").replace(".", "_")
        to_safe = e["to"].replace("/", "_").replace("-", "_").replace(".", "_")
        mermaid_lines.append(f"  {from_safe}-->|depends| {to_safe}")

    html = f"""<!DOCTYPE html>
<html lang="pt-br">
<head><meta charset="UTF-8">
<title>Graphify - {root.name}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
body{{font-family:system-ui;display:flex;flex-direction:column;align-items:center;padding:2rem;background:#f5f5f0}}
.mermaid{{background:white;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:100%}}
h1{{color:#1a1a1a}}
</style></head><body>
<h1>{root.name}</h1>
<p><small>Atualizado em {datetime.now().strftime('%Y-%m-%d %H:%M')}</small></p>
<div class="mermaid">{chr(10).join(mermaid_lines)}</div>
<script>mermaid.initialize({{startOnLoad:true}})</script></body></html>"""
    (graphify_dir / "index.html").write_text(html)

    return {"nodes": len(nodes), "edges": len(edges), "html_written": True}


def update_gbrain(root: Path, last_msg: str) -> dict:
    """Extrai decisoes da ultima mensagem e adiciona em .gbrain/context.json."""
    gbrain_dir = root / ".gbrain"
    gbrain_dir.mkdir(parents=True, exist_ok=True)

    ctx_file = gbrain_dir / "context.json"
    ctx = {
        "project": root.name, "description": "", "objectives": [],
        "stakeholders": [], "decisions": [], "glossary": {},
        "createdAt": datetime.now().isoformat()
    }
    if ctx_file.exists():
        try:
            ctx = json.loads(ctx_file.read_text())
        except:
            pass

    decisions_found = re.findall(
        r'(?:Decis[ãa]o|Decision|Optamos por|Vamos usar|Escolhemos)\s*:?\s*([^.]+)',
        last_msg[:3000], re.IGNORECASE
    )
    existing_texts = {d.get("text", "") for d in ctx.get("decisions", [])}
    added = 0
    for dec in decisions_found:
        dec_clean = dec.strip()[:200]
        if dec_clean and dec_clean not in existing_texts:
            ctx.setdefault("decisions", []).append({
                "text": dec_clean,
                "date": datetime.now().isoformat(),
                "source": f"sprint-{datetime.now().strftime('%Y%m%d')}"
            })
            existing_texts.add(dec_clean)
            added += 1

    ctx["updatedAt"] = datetime.now().isoformat()
    ctx_file.write_text(json.dumps(ctx, indent=2, ensure_ascii=False))

    return {"decisions_added": added, "total_decisions": len(ctx.get("decisions", []))}


def record_mom(session_summary: str, project: str) -> dict:
    """Salva resumo no MOM (apenas macOS)."""
    if sys.platform != "darwin":
        return {"status": "skipped", "reason": "MOM: apenas macOS"}
    try:
        result = subprocess.run(
            ["mom", "remember", f"[{project}] {session_summary[:500]}"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return {"status": "saved"}
        return {"status": "error", "stderr": result.stderr[:200]}
    except Exception as e:
        return {"status": "error", "reason": str(e)}


def enrich_chronicle(chronicle_dir: Path, project_name: str, decisions: list, graph_summary: str) -> dict:
    """Adiciona decisoes e sumario do grafo ao ultimo arquivo chronicle."""
    chronicle_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(chronicle_dir.glob(f"{project_name}_*.md"), reverse=True)
    if not files:
        return {"status": "no chronicle file found"}

    latest = files[0]
    content = latest.read_text(encoding="utf-8")

    if decisions:
        dec_lines = ["", "## Decisoes do Sprint", ""]
        for d in decisions:
            dec_lines.append(f"- {d.get('text', '')} ({d.get('date', '')})")
        content += "\n".join(dec_lines)

    if graph_summary:
        content += f"\n\n## Grafos Atualizados\n{graph_summary}\n"

    latest.write_text(content, encoding="utf-8")
    return {"status": "enriched", "file": latest.name}


def main():
    inp = json.loads(sys.stdin.read())
    cwd = inp.get("cwd", "")
    last_msg = inp.get("last_assistant_message", "")

    root = Path(cwd) if cwd else None
    if not root or not root.exists():
        print(json.dumps({"error": "cwd invalido", "cwd": cwd}))
        sys.exit(1)

    project_name = root.name
    chronicle_dir = Path.home() / ".codex" / "chronicle"

    graphify_result = update_graphify(root, last_msg)
    gbrain_result = update_gbrain(root, last_msg)
    mom_result = record_mom(last_msg[:500], project_name)

    decisions = gbrain_result.get("decisions_added", 0)
    graph_summary = f"{graphify_result.get('nodes', 0)} nodes, {graphify_result.get('edges', 0)} edges"
    chronicle_result = enrich_chronicle(chronicle_dir, project_name, decisions, graph_summary)

    result = {
        "project": project_name,
        "graphify": graphify_result,
        "gbrain": gbrain_result,
        "mom": mom_result,
        "chronicle": chronicle_result,
        "timestamp": datetime.now().isoformat()
    }
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
