#!/usr/bin/env python3
"""Document Graph local — indexer/busca determinística, offline, sem LLM.

Usa SOMENTE stdlib: sqlite3 (estável desde 2006) + FTS5 (estável desde 2015,
embutido no Python oficial). Sem dependência nativa npm. Se FTS5 não existir
num build mínimo, cai para LIKE (degrada, não quebra).

Subcomandos:
  index  --db <p> --root <dir> [--reindex]
  search --db <p> --query "<q>" [--limit N] [--json]
  related --db <p> --entity "<nome>" [--json]
  status --db <p> [--json]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1

# Fontes obrigatórias (relativas ao root do projeto)
DOC_GLOBS = [
    ("adr", "docs/adr"),
    ("prd", "docs/prd"),
    ("plans", "docs/plans"),
    ("research", "docs/research"),
]
EXTRA_FILES = [("readme", "README.md"), ("changelog", "CHANGELOG.md")]

# Nunca indexar (segurança/ruído)
UNSAFE_PARTS = {".git", "node_modules", "dist", "build", ".venv", "__pycache__", ".gstack"}
UNSAFE_NAME_PREFIX = (".env",)

STOPWORDS = {
    "readme", "todo", "the", "this", "that", "and", "for", "with", "from",
    "changelog", "note", "notes", "example", "test", "tests", "http", "https",
}
# Tecnologias conhecidas (lista configurável mínima)
KNOWN_TECH = {
    "casdoor", "fallow", "graphify", "headroom", "opencode", "composio",
    "stripe", "supabase", "sqlite", "fts5", "openhands", "playwright",
}

WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
TAG_RE = re.compile(r"(?:^|\s)#([a-zA-Z][\w-]{1,30})")
PASCAL_RE = re.compile(r"\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b")  # PascalCase
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()


def connect(db_path: str) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


def fts5_available(con: sqlite3.Connection) -> bool:
    try:
        con.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x)")
        con.execute("DROP TABLE IF EXISTS _fts_probe")
        return True
    except sqlite3.OperationalError:
        return False


def init_schema(con: sqlite3.Connection) -> bool:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS documents(
          id INTEGER PRIMARY KEY, path TEXT UNIQUE, source TEXT, kind TEXT,
          title TEXT, mtime REAL, hash TEXT, indexed_at TEXT);
        CREATE TABLE IF NOT EXISTS chunks(
          id INTEGER PRIMARY KEY, document_id INTEGER, heading TEXT, content TEXT,
          start_line INTEGER, end_line INTEGER, hash TEXT,
          FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS entities(
          id INTEGER PRIMARY KEY, name TEXT, normalized_name TEXT UNIQUE, kind TEXT);
        CREATE TABLE IF NOT EXISTS doc_entities(
          document_id INTEGER, entity_id INTEGER, count INTEGER,
          PRIMARY KEY(document_id, entity_id),
          FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS edges(
          id INTEGER PRIMARY KEY, from_type TEXT, from_id INTEGER, to_type TEXT,
          to_id INTEGER, relation TEXT, evidence TEXT, document_id INTEGER,
          FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS index_meta(key TEXT PRIMARY KEY, value TEXT);
        """
    )
    has_fts = fts5_available(con)
    if has_fts:
        # FTS5 padrão (guarda o próprio conteúdo) — snippet()/colunas recuperáveis.
        con.execute("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(content, heading, path)")
    con.execute("INSERT OR REPLACE INTO index_meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),))
    con.execute("INSERT OR REPLACE INTO index_meta(key,value) VALUES('fts_enabled',?)", ("1" if has_fts else "0"))
    con.commit()
    return has_fts


def is_safe(path: Path) -> bool:
    parts = set(p.lower() for p in path.parts)
    if parts & UNSAFE_PARTS:
        return False
    if path.name.lower().startswith(UNSAFE_NAME_PREFIX):
        return False
    return True


def discover(root: Path) -> list[tuple[str, str, Path]]:
    """Retorna (source, kind, path) das fontes a indexar."""
    found = []
    for source, rel in DOC_GLOBS:
        d = root / rel
        if d.exists():
            for f in sorted(d.rglob("*.md")):
                if f.is_file() and is_safe(f.relative_to(root)) and f.name != ".gitkeep":
                    found.append((source, source, f))
    for kind, rel in EXTRA_FILES:
        f = root / rel
        if f.exists() and f.is_file():
            found.append(("repo", kind, f))
    return found


def chunk_markdown(text: str) -> list[dict]:
    """Divide por heading, preservando heading e linhas aproximadas."""
    lines = text.splitlines()
    chunks = []
    cur = {"heading": "", "start": 1, "buf": []}

    def flush(end_line):
        content = "\n".join(cur["buf"]).strip()
        if content:
            chunks.append({"heading": cur["heading"], "content": content,
                           "start_line": cur["start"], "end_line": end_line})

    for i, line in enumerate(lines, 1):
        m = HEADING_RE.match(line)
        if m:
            flush(i - 1)
            cur = {"heading": m.group(2).strip(), "start": i, "buf": [line]}
        else:
            cur["buf"].append(line)
    flush(len(lines))
    return chunks or [{"heading": "", "content": text.strip(), "start_line": 1, "end_line": len(lines)}]


def extract_entities(text: str) -> dict[str, dict]:
    """Heurística determinística → {normalized: {name, kind, count}}."""
    ents: dict[str, dict] = {}

    def add(name, kind):
        norm = name.strip().lower()
        if not norm or norm in STOPWORDS or len(norm) < 3:
            return
        e = ents.setdefault(norm, {"name": name.strip(), "kind": kind, "count": 0})
        e["count"] += 1

    for m in WIKILINK_RE.finditer(text):
        add(m.group(1), "wikilink")
    for m in TAG_RE.finditer(text):
        add(m.group(1), "tag")
    for m in PASCAL_RE.finditer(text):
        add(m.group(1), "term")
    low = text.lower()
    for tech in KNOWN_TECH:
        if tech in low:
            add(tech, "tech")
    return ents


def upsert_entity(con, name, normalized, kind) -> int:
    con.execute("INSERT OR IGNORE INTO entities(name,normalized_name,kind) VALUES(?,?,?)", (name, normalized, kind))
    row = con.execute("SELECT id FROM entities WHERE normalized_name=?", (normalized,)).fetchone()
    return row["id"]


def delete_document(con, doc_id):
    # ON DELETE CASCADE cobre chunks/doc_entities/edges; FTS é content-less, limpamos por path no reindex
    con.execute("DELETE FROM documents WHERE id=?", (doc_id,))


def index_cmd(args) -> int:
    con = connect(args.db)
    has_fts = init_schema(con)
    root = Path(args.root).resolve()
    discovered = discover(root)
    disc_paths = {str(f.relative_to(root).as_posix()) for _, _, f in discovered}

    # Remoção: documentos que sumiram das fontes
    for row in con.execute("SELECT id, path FROM documents").fetchall():
        if row["path"] not in disc_paths:
            delete_document(con, row["id"])
            if has_fts:
                con.execute("DELETE FROM chunks_fts WHERE path=?", (row["path"],))

    indexed = 0
    for source, kind, f in discovered:
        rel = f.relative_to(root).as_posix()
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        h = file_hash(text)
        existing = con.execute("SELECT id, hash FROM documents WHERE path=?", (rel,)).fetchone()
        if existing and existing["hash"] == h and not args.reindex:
            continue  # incremental: inalterado
        if existing:
            delete_document(con, existing["id"])
            if has_fts:
                con.execute("DELETE FROM chunks_fts WHERE path=?", (rel,))
        title = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), f.stem)
        con.execute(
            "INSERT INTO documents(path,source,kind,title,mtime,hash,indexed_at) VALUES(?,?,?,?,?,?,?)",
            (rel, source, kind, title, f.stat().st_mtime, h, now_iso()))
        doc_id = con.execute("SELECT id FROM documents WHERE path=?", (rel,)).fetchone()["id"]

        for ch in chunk_markdown(text):
            con.execute(
                "INSERT INTO chunks(document_id,heading,content,start_line,end_line,hash) VALUES(?,?,?,?,?,?)",
                (doc_id, ch["heading"], ch["content"], ch["start_line"], ch["end_line"], file_hash(ch["content"])))
            if has_fts:
                con.execute("INSERT INTO chunks_fts(content,heading,path) VALUES(?,?,?)",
                            (ch["content"], ch["heading"], rel))

        for norm, e in extract_entities(text).items():
            eid = upsert_entity(con, e["name"], norm, e["kind"])
            con.execute("INSERT OR REPLACE INTO doc_entities(document_id,entity_id,count) VALUES(?,?,?)",
                        (doc_id, eid, e["count"]))
            rel_kind = {"wikilink": "links_to", "tag": "tagged_as"}.get(e["kind"], "mentions")
            con.execute(
                "INSERT INTO edges(from_type,from_id,to_type,to_id,relation,evidence,document_id) VALUES('document',?,'entity',?,?,?,?)",
                (doc_id, eid, rel_kind, (e["name"])[:80], doc_id))
        indexed += 1

    con.execute("INSERT OR REPLACE INTO index_meta(key,value) VALUES('indexed_at',?)", (now_iso(),))
    con.commit()
    out = {"indexed": indexed, "documents": count(con, "documents"), "fts_enabled": has_fts}
    print(json.dumps(out) if args.json else f"Indexados {indexed} doc(s). Total: {out['documents']}. FTS={'on' if has_fts else 'LIKE'}")
    return 0


def count(con, table) -> int:
    return con.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]


def search_cmd(args) -> int:
    con = connect(args.db)
    fts = con.execute("SELECT value FROM index_meta WHERE key='fts_enabled'").fetchone()
    has_fts = bool(fts and fts["value"] == "1")
    q = args.query.strip()
    rows = []
    if has_fts:
        try:
            rows = con.execute(
                "SELECT path, heading, snippet(chunks_fts,0,'[',']','…',8) AS snip, rank "
                "FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?",
                (q, args.limit)).fetchall()
        except sqlite3.OperationalError:
            has_fts = False
    if not has_fts:
        like = f"%{q}%"
        rows = con.execute(
            "SELECT d.path AS path, c.heading AS heading, substr(c.content,1,160) AS snip, 0 AS rank "
            "FROM chunks c JOIN documents d ON d.id=c.document_id "
            "WHERE c.content LIKE ? LIMIT ?", (like, args.limit)).fetchall()
    results = [{"path": r["path"], "heading": r["heading"], "snippet": r["snip"], "score": r["rank"]} for r in rows]
    if args.json:
        print(json.dumps({"query": q, "fts": has_fts, "results": results}))
    else:
        if not results:
            print("(sem resultados)")
        for r in results:
            print(f"  {r['path']}  [{r['heading'] or '-'}]\n    {r['snippet']}")
    return 0


def related_cmd(args) -> int:
    con = connect(args.db)
    norm = args.entity.strip().lower()
    ent = con.execute("SELECT id,name,kind FROM entities WHERE normalized_name=? OR name=?",
                      (norm, args.entity)).fetchone()
    if not ent:
        print(json.dumps({"entity": args.entity, "found": False}) if args.json else f"Entidade '{args.entity}' não encontrada.")
        return 0
    docs = con.execute(
        "SELECT d.path, d.title, de.count, e.relation FROM doc_entities de "
        "JOIN documents d ON d.id=de.document_id "
        "JOIN edges e ON e.document_id=de.document_id AND e.to_id=de.entity_id "
        "WHERE de.entity_id=? GROUP BY d.path ORDER BY de.count DESC", (ent["id"],)).fetchall()
    out = {"entity": ent["name"], "kind": ent["kind"], "found": True,
           "documents": [{"path": d["path"], "title": d["title"], "count": d["count"], "relation": d["relation"]} for d in docs]}
    if args.json:
        print(json.dumps(out))
    else:
        print(f"{ent['name']} ({ent['kind']}):")
        for d in out["documents"]:
            print(f"  {d['relation']}: {d['path']} (x{d['count']})")
    return 0


def status_cmd(args) -> int:
    con = connect(args.db)
    fts = con.execute("SELECT value FROM index_meta WHERE key='fts_enabled'").fetchone()
    out = {
        "documents": count(con, "documents"), "chunks": count(con, "chunks"),
        "entities": count(con, "entities"), "edges": count(con, "edges"),
        "fts_enabled": bool(fts and fts["value"] == "1"),
    }
    if args.json:
        print(json.dumps(out))
    else:
        print(f"documents={out['documents']} chunks={out['chunks']} entities={out['entities']} "
              f"edges={out['edges']} fts={'on' if out['fts_enabled'] else 'LIKE'}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Document Graph local (SQLite/FTS5 stdlib)")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("index", "search", "related", "status"):
        sp = sub.add_parser(name)
        sp.add_argument("--db", required=True)
        sp.add_argument("--json", action="store_true")
        if name == "index":
            sp.add_argument("--root", required=True)
            sp.add_argument("--reindex", action="store_true")
        if name == "search":
            sp.add_argument("--query", required=True)
            sp.add_argument("--limit", type=int, default=10)
        if name == "related":
            sp.add_argument("--entity", required=True)
    args = p.parse_args()
    return {"index": index_cmd, "search": search_cmd, "related": related_cmd, "status": status_cmd}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
