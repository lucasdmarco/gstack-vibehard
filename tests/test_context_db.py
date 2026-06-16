"""Document Graph: indexer SQLite/FTS5 (stdlib). Roda o script como subprocess."""
import json
import os
import subprocess
import sys
import sqlite3
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "src" / "context-docs" / "py" / "context_db.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, timeout=60)


def make_project(tmp):
    root = Path(tmp) / "proj"
    (root / "docs" / "adr").mkdir(parents=True)
    (root / "docs" / "adr" / "001.md").write_text(
        "# ADR 001: Casdoor\nUsamos [[Casdoor]] para #iam. Decisao sobre OpenCode.\n", encoding="utf-8")
    (root / "README.md").write_text("# Projeto\nUsa Stripe e Supabase.\n", encoding="utf-8")
    return root


class ContextDbTest(unittest.TestCase):
    def test_index_search_related_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            db = str(root / ".gstack" / "context" / "context.db")
            r = run("index", "--db", db, "--root", str(root), "--json")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["indexed"], 2)

            st = json.loads(run("status", "--db", db, "--json").stdout)
            self.assertEqual(st["documents"], 2)
            self.assertGreaterEqual(st["entities"], 1)

            sr = json.loads(run("search", "--db", db, "--query", "Casdoor", "--json").stdout)
            self.assertTrue(any("adr/001.md" in x["path"] for x in sr["results"]))

            rel = json.loads(run("related", "--db", db, "--entity", "Casdoor", "--json").stdout)
            self.assertTrue(rel["found"])
            self.assertTrue(any("adr/001.md" in d["path"] for d in rel["documents"]))

    def test_idempotente_incremental_remocao(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root))
            # idempotente: re-index sem mudança -> indexed 0
            r2 = json.loads(run("index", "--db", db, "--root", str(root), "--json").stdout)
            self.assertEqual(r2["indexed"], 0)
            # incremental: editar 1 arquivo -> reindexa só ele
            (root / "docs" / "adr" / "001.md").write_text("# ADR 001 v2\nNovo conteudo Headroom.\n", encoding="utf-8")
            r3 = json.loads(run("index", "--db", db, "--root", str(root), "--json").stdout)
            self.assertEqual(r3["indexed"], 1)
            # remoção: apagar arquivo -> cascade (documents cai)
            (root / "README.md").unlink()
            run("index", "--db", db, "--root", str(root))
            st = json.loads(run("status", "--db", db, "--json").stdout)
            self.assertEqual(st["documents"], 1)

    def test_nao_indexa_env_secrets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            (root / "docs" / "adr" / ".env").write_text("SECRET=abc123\n", encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root))
            con = sqlite3.connect(db)
            paths = [r[0] for r in con.execute("SELECT path FROM documents").fetchall()]
            con.close()
            self.assertFalse(any(".env" in p for p in paths), "arquivos .env nao podem ser indexados")

    def test_status_reporta_fts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root))
            st = json.loads(run("status", "--db", db, "--json").stdout)
            self.assertIn("fts_enabled", st)


if __name__ == "__main__":
    unittest.main()
