"""Shared chronicle index/search utilities for gc.py and session_start.py."""
import os
from _paths import chronicle_dir


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
