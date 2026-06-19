"""Dial de token (Camada A) por projeto via .gstack/profile.json.

minimal  = loop barato (sem identidade no session_start, sem chronicle no stop)
standard = enxuto (com identidade)
full     = tudo
Fail-open: ausente/inválido → standard."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / "hooks" / "hooks"
sys.path.insert(0, str(HOOKS))

from _paths import token_budget, read_project_profile  # noqa: E402


def run_hook(name, stdin_text, cwd=None):
    return subprocess.run(
        [sys.executable, str(HOOKS / name)],
        input=stdin_text, capture_output=True, text=True, timeout=60, cwd=cwd,
    )


def make_proj(tmp, budget):
    proj = Path(tmp) / "p"
    (proj / ".gstack").mkdir(parents=True)
    if budget is not None:
        (proj / ".gstack" / "profile.json").write_text(
            json.dumps({"profile": "cli", "mode": "observe", "tokenBudget": budget}),
            encoding="utf-8",
        )
    return proj


class TokenBudgetHelperTest(unittest.TestCase):
    def test_default_standard_quando_ausente(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = make_proj(tmp, None)
            self.assertEqual(token_budget(str(proj)), "standard")

    def test_le_nivel_do_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = make_proj(tmp, "minimal")
            self.assertEqual(token_budget(str(proj)), "minimal")
            self.assertEqual(read_project_profile(str(proj))["profile"], "cli")

    def test_valor_invalido_cai_para_standard(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = make_proj(tmp, "turbo-9000")
            self.assertEqual(token_budget(str(proj)), "standard")


class DialAppliedTest(unittest.TestCase):
    def test_stop_minimal_pula_chronicle(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = make_proj(tmp, "minimal")
            payload = json.dumps({"cwd": str(proj), "last_assistant_message": "ok", "flags": {}})
            r = run_hook("stop.py", payload, cwd=str(proj))
            self.assertEqual(r.returncode, 0, r.stderr)
            out = r.stdout + r.stderr
            self.assertIn("minimal", out)
            self.assertNotIn("Memorias salvas", out)

    def test_session_start_minimal_sem_identidade(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = make_proj(tmp, "minimal")
            r = run_hook("session_start.py", json.dumps({"cwd": str(proj)}), cwd=str(proj))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertNotIn("Identity & Standard", r.stdout)

    def test_session_start_standard_injeta_identidade(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = make_proj(tmp, "standard")
            r = run_hook("session_start.py", json.dumps({"cwd": str(proj)}), cwd=str(proj))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("Identity & Standard", r.stdout)


if __name__ == "__main__":
    unittest.main()
