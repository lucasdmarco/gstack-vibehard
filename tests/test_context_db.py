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

    def test_obsidian_opt_in_readonly(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            vault = Path(tmp) / "vault"
            vault.mkdir()
            (vault / "nota.md").write_text("# Nota\nLink [[Casdoor]].\n", encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            # sem --obsidian: nota NÃO entra
            run("index", "--db", db, "--root", str(root))
            self.assertFalse(any("obsidian/" in x["path"]
                                 for x in json.loads(run("search", "--db", db, "--query", "Nota", "--json").stdout)["results"]))
            # com --obsidian: nota entra como source=obsidian (read-only)
            run("index", "--db", db, "--root", str(root), "--obsidian", str(vault))
            sr = json.loads(run("search", "--db", db, "--query", "Casdoor", "--json").stdout)
            self.assertTrue(any("obsidian/nota.md" in x["path"] for x in sr["results"]))
            # vault não foi modificado (read-only)
            self.assertEqual((vault / "nota.md").read_text(encoding="utf-8"), "# Nota\nLink [[Casdoor]].\n")

    def test_obsidian_pasta_ausente_nao_quebra(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            db = str(root / ".gstack" / "context" / "context.db")
            r = run("index", "--db", db, "--root", str(root), "--obsidian", str(Path(tmp) / "naoexiste"))
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_graphify_bridge_implemented_depends(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            (root / "docs" / "adr" / "001.md").write_text("# ADR\n[[Auth]] usa [[Casdoor]].\n", encoding="utf-8")
            gdir = root / "graphify-out"
            gdir.mkdir()
            (gdir / "graph.json").write_text(
                '{"nodes":[{"id":"n1","name":"Auth"},{"id":"n2","name":"Casdoor"}],"edges":[{"from":"n1","to":"n2"}]}',
                encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root), "--graphify", str(gdir / "graph.json"))
            rel = json.loads(run("related", "--db", db, "--entity", "Auth", "--json").stdout)
            rels = {c["relation"] for c in rel.get("code", [])}
            self.assertIn("depends_on", rels)
            self.assertIn("implemented_in", rels)

    def test_graphify_implemented_in_atribuido_a_entidade_certa(self):
        # Dois símbolos no MESMO doc, mas só 'Auth' casa um nó de código.
        # 'implemented_in' deve pertencer a Auth, NUNCA a Casdoor (mesmo doc).
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            (root / "docs" / "adr" / "001.md").write_text("# ADR\n[[Auth]] usa [[Casdoor]].\n", encoding="utf-8")
            gdir = root / "graphify-out"
            gdir.mkdir()
            # grafo só tem o nó 'Auth' (Casdoor não existe no código)
            (gdir / "graph.json").write_text(
                '{"nodes":[{"id":"n1","name":"Auth"}],"edges":[]}', encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root), "--graphify", str(gdir / "graph.json"))

            rel_auth = json.loads(run("related", "--db", db, "--entity", "Auth", "--json").stdout)
            rel_cas = json.loads(run("related", "--db", db, "--entity", "Casdoor", "--json").stdout)
            self.assertIn("implemented_in", {c["relation"] for c in rel_auth.get("code", [])},
                          "Auth (casado no grafo) deve ter implemented_in")
            self.assertNotIn("implemented_in", {c["relation"] for c in rel_cas.get("code", [])},
                             "Casdoor (não casado) NÃO pode herdar o implemented_in do mesmo doc")

    def test_graphify_ausente_nao_quebra(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            db = str(root / ".gstack" / "context" / "context.db")
            r = run("index", "--db", db, "--root", str(root))  # sem --graphify
            self.assertEqual(r.returncode, 0)

    # PRD51 S51.5.3 (ação #5) — prioridade: repo (contratos) > adr/prd/plans/docs
    # > research (mirrors). CLAUDE.md (source=repo) e docs/adr/001.md (source=adr)
    # mencionam a MESMA palavra-chave num termo raro (evita ranking por FTS puro
    # coincidir com a ordem esperada por acaso) — só a prioridade por fonte decide.
    def test_search_prioriza_source_tier_repo_antes_de_research(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            (root / "CLAUDE.md").write_text("# Contrato\nUsamos Zylofoo em producao.\n", encoding="utf-8")
            (root / ".docs" / "RESEARCH").mkdir(parents=True)
            (root / ".docs" / "RESEARCH" / "mirror.md").write_text("# Mirror\nZylofoo mencionado aqui tambem.\n", encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root))
            sr = json.loads(run("search", "--db", db, "--query", "Zylofoo", "--json").stdout)
            paths = [r["path"] for r in sr["results"]]
            self.assertLess(paths.index("CLAUDE.md"), paths.index(".docs/RESEARCH/mirror.md"),
                             "repo (contrato) deve vir ANTES de research (mirror) na mesma busca")

    # PRD51 S51.5.3 (ação #6) — filtro por tipo (--source) e origem (--kind).
    def test_search_filtro_por_source_e_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            (root / ".docs" / "PLANS").mkdir(parents=True)
            (root / ".docs" / "PLANS" / "prd99.md").write_text("# PRD99\nWombatrix em progresso.\n", encoding="utf-8")
            (root / "README.md").write_text("# Projeto\nWombatrix tambem aparece no readme.\n", encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root))
            only_prd = json.loads(run("search", "--db", db, "--query", "Wombatrix", "--source", "prd", "--json").stdout)
            self.assertTrue(all(r["path"].endswith("prd99.md") for r in only_prd["results"]))
            self.assertTrue(len(only_prd["results"]) >= 1)
            only_plans_kind = json.loads(run("search", "--db", db, "--query", "Wombatrix", "--kind", "plans", "--json").stdout)
            self.assertTrue(all("PLANS" in r["path"] for r in only_plans_kind["results"]))

    # PRD51 S51.5.3 (ação #6) — filtro por recência (--since).
    def test_search_filtro_por_since_exclui_documento_antigo(self):
        with tempfile.TemporaryDirectory() as tmp:
            import os
            root = make_project(tmp)
            old = root / "docs" / "adr" / "old.md"
            old.write_text("# ADR antigo\nFluxogramix decidido ha muito tempo.\n", encoding="utf-8")
            os.utime(old, (946684800, 946684800))  # 2000-01-01, bem antigo
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root))
            recent = json.loads(run("search", "--db", db, "--query", "Fluxogramix", "--since", "2020-01-01T00:00:00Z", "--json").stdout)
            self.assertEqual(recent["results"], [], "documento de 2000 nao deve passar no filtro --since 2020")
            everything = json.loads(run("search", "--db", db, "--query", "Fluxogramix", "--json").stdout)
            self.assertTrue(len(everything["results"]) >= 1, "sem --since, o documento antigo aparece normalmente")

    # PRD51 S51.5.3 (ação #7) — conteúdo espelhado (mesmo hash, paths diferentes)
    # aparece só UMA vez na busca (o path canônico, alfabeticamente menor).
    def test_dedupe_conteudo_espelhado_aparece_uma_vez_na_busca(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            same_content = "# Espelhado\nGorbelquin aparece em dois lugares identicos.\n"
            (root / "docs" / "adr" / "a-original.md").write_text(same_content, encoding="utf-8")
            (root / ".docs" / "RESEARCH").mkdir(parents=True)
            (root / ".docs" / "RESEARCH" / "z-mirror.md").write_text(same_content, encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            run("index", "--db", db, "--root", str(root))
            sr = json.loads(run("search", "--db", db, "--query", "Gorbelquin", "--json").stdout)
            self.assertEqual(len(sr["results"]), 1, "conteudo identico em 2 paths so aparece 1x na busca")
            self.assertTrue(sr["results"][0]["path"].endswith("a-original.md"), "path CANONICO (alfabeticamente menor) vence")
            # o duplicado continua RASTREADO no status (nunca apagado do disco/DB)
            st = json.loads(run("status", "--db", db, "--json").stdout)
            self.assertEqual(st["documents"], 4, "documento duplicado continua contado (nao e apagado)")

    # PRD51 S51.5.3 (ação #8) — PRD49/PRD50/manual REAIS (não fixture sintética)
    # são encontráveis via search depois de indexados no layout real do repo.
    def test_prd49_prd50_manual_reais_sao_encontraveis(self):
        prd49 = REPO_ROOT / ".docs" / "PLANS" / "prd49.md"
        prd50 = REPO_ROOT / ".docs" / "PLANS" / "prd50.md"
        manual = REPO_ROOT / ".docs" / "PLANS" / "manualdeengenhariacomia.md"
        for p in (prd49, prd50, manual):
            if not p.exists():
                self.skipTest(f"{p} nao existe nesta arvore (achado de S51.5.3 exige os arquivos reais)")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            (root / ".docs" / "PLANS").mkdir(parents=True)
            (root / ".docs" / "PLANS" / "prd49.md").write_text(prd49.read_text(encoding="utf-8"), encoding="utf-8")
            (root / ".docs" / "PLANS" / "prd50.md").write_text(prd50.read_text(encoding="utf-8"), encoding="utf-8")
            (root / ".docs" / "PLANS" / "manualdeengenhariacomia.md").write_text(manual.read_text(encoding="utf-8"), encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            r = run("index", "--db", db, "--root", str(root), "--json")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["indexed"], 3)
            sr49 = json.loads(run("search", "--db", db, "--query", "PRD49", "--json").stdout)
            self.assertTrue(any("prd49.md" in x["path"] for x in sr49["results"]), "PRD49 real deve ser encontrável")
            sr50 = json.loads(run("search", "--db", db, "--query", "PRD50", "--json").stdout)
            self.assertTrue(any("prd50.md" in x["path"] for x in sr50["results"]), "PRD50 real deve ser encontrável")
            st = json.loads(run("status", "--db", db, "--json").stdout)
            self.assertEqual(st["by_source"].get("prd"), 2, "prd49/prd50 classificados como source=prd (pelo nome do arquivo)")

    # PRD51 DOD.15 do §9 — "busca de contexto encontra PRD49, PRD50, PRD51 e manual
    # atual". As duas primeiras metades ja eram provadas acima. Faltavam o proprio
    # PRD51 e o manual do projeto — e a ausencia estava REGISTRADA como pendencia no
    # checklist em vez de presumida resolvida. Indexar era trivial; o que faltava era
    # exatamente isto: a prova.
    def test_prd51_e_manual_do_projeto_sao_encontraveis(self):
        prd51 = REPO_ROOT / ".docs" / "PLANS" / "prd51.md"
        manual = REPO_ROOT / ".docs" / "PLANS" / "projetogstack.md"
        for p in (prd51, manual):
            if not p.exists():
                self.skipTest(f"{p} nao existe nesta arvore (`.docs/` e gitignored)")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            (root / ".docs" / "PLANS").mkdir(parents=True)
            (root / ".docs" / "PLANS" / "prd51.md").write_text(prd51.read_text(encoding="utf-8"), encoding="utf-8")
            (root / ".docs" / "PLANS" / "projetogstack.md").write_text(manual.read_text(encoding="utf-8"), encoding="utf-8")
            db = str(root / ".gstack" / "context" / "context.db")
            r = run("index", "--db", db, "--root", str(root), "--json")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["indexed"], 2)
            sr51 = json.loads(run("search", "--db", db, "--query", "PRD51", "--json").stdout)
            self.assertTrue(any("prd51.md" in x["path"] for x in sr51["results"]), "PRD51 real deve ser encontravel")
            # O manual e encontravel pelo termo que o identifica, nao por um id de PRD.
            srm = json.loads(run("search", "--db", db, "--query", "GStack VibeHard", "--json").stdout)
            self.assertTrue(any("projetogstack.md" in x["path"] for x in srm["results"]), "manual atual deve ser encontravel")


if __name__ == "__main__":
    unittest.main()
