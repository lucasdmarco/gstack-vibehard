"""post_tool_use_review.py — roteador incremental limitado (PRD36 36.2).

Substitui o `npx fallow audit` COMPLETO por ação (caro, erro da v2.2.0) por uma
recomendação de checagem INCREMENTAL escolhida pelo tipo do diff. Prova:
  - nunca roda/menciona fallow completo nem a suíte inteira;
  - recomenda a checagem certa por tipo (frontend→visual-evidence etc.);
  - é advisory (tool.after observa, não bloqueia);
  - FAIL-OPEN em input malformado (exit 0, sem stacktrace).
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / "hooks" / "hooks" / "post_tool_use_review.py"


def run_hook(payload, cwd=None):
    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=payload if isinstance(payload, str) else json.dumps(payload),
        capture_output=True, text=True, cwd=cwd, timeout=30,
    )
    return proc


class PostToolReviewTest(unittest.TestCase):
    def test_frontend_recommends_visual_and_incremental(self):
        p = run_hook({"tool_name": "Write", "tool_input": {"file_path": "apps/web/src/components/Card.tsx"}})
        self.assertEqual(p.returncode, 0)
        out = json.loads(p.stdout)
        self.assertEqual(out["level"], "advisory")
        self.assertEqual(out["primary"], "frontend")
        self.assertIn("visual-evidence", out["checks"])
        self.assertIn("incremental-tests", out["checks"])
        self.assertFalse(out["ranFullSuite"])

    def test_migration_recommends_migration_present(self):
        p = run_hook({"tool_name": "Edit", "tool_input": {"file_path": "packages/db/migrations/0001_init.sql"}})
        out = json.loads(p.stdout)
        self.assertEqual(out["primary"], "migration")
        self.assertIn("migration-present", out["checks"])

    def test_never_runs_full_fallow_or_suite(self):
        p = run_hook({"tool_name": "Write", "tool_input": {"file_path": "apps/api/routes/users.ts"}})
        blob = p.stdout.lower()
        self.assertNotIn("fallow audit", blob)
        self.assertNotIn("full-suite", blob)
        out = json.loads(p.stdout)
        self.assertFalse(out["ranFullSuite"])
        self.assertIn("incremental-tests", out["checks"])

    def test_fail_open_on_garbage(self):
        p = run_hook("not json at all {{{")
        self.assertEqual(p.returncode, 0)  # nunca trava o turno

    def test_records_advisory_ledger_scoped_to_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_hook({"tool_name": "Write", "tool_input": {"file_path": "apps/web/src/App.tsx"}, "cwd": tmp}, cwd=tmp)
            ledger = Path(tmp) / ".gstack" / "events" / "post-tool.jsonl"
            self.assertTrue(ledger.exists(), "advisory gravado no ledger do cwd")
            line = json.loads(ledger.read_text(encoding="utf-8").strip().splitlines()[-1])
            self.assertEqual(line["event"], "tool.after")
            self.assertFalse(line["ranFullSuite"])

    def test_bash_without_file_has_no_checks(self):
        p = run_hook({"tool_name": "Bash", "tool_input": {"command": "ls -la"}})
        out = json.loads(p.stdout)
        self.assertEqual(out["checks"], [])
        self.assertEqual(out["primary"], "none")


if __name__ == "__main__":
    unittest.main()
