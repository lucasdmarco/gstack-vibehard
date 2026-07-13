"""Challenge-Response no PreToolUse (PRD14 §6.4).

O hook pre_tool_use_security.py invoca `gstack_vibehard challenge pretool` para
acoes de ALTO RISCO (config global de harness / comando destrutivo desafiavel),
SOMENTE em projeto gstack. Regras de ouro: fail-open (CLI ausente/erro nunca
bloqueia) e passividade fora de projeto gstack.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / "hooks" / "hooks"
IS_WIN = os.name == "nt"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _marker import mark_project  # noqa: E402


def make_stub_cli(tmpdir, decision_json):
    """Cria um executavel fake `gstack_vibehard` que imprime a decisao dada."""
    d = Path(tmpdir)
    if IS_WIN:
        exe = d / "gstack_vibehard.cmd"
        exe.write_text("@echo off\necho %s\n" % decision_json.replace('"', '^"'), encoding="utf-8")
    else:
        exe = d / "gstack_vibehard"
        exe.write_text("#!/bin/sh\necho '%s'\n" % decision_json, encoding="utf-8")
        exe.chmod(0o755)
    return exe


def run_hook(stdin_obj, cwd, extra_env=None):
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, str(HOOKS / "pre_tool_use_security.py")],
        input=json.dumps(stdin_obj), capture_output=True, text=True, timeout=60,
        cwd=cwd, env=env,
    )


def global_config_write(cwd):
    """Tool call de Write numa config GLOBAL de harness (alto risco)."""
    target = str(Path.home() / ".claude" / "settings.json")
    return {"tool_name": "Write", "tool_input": {"file_path": target}, "cwd": cwd}


class ChallengePretoolHookTest(unittest.TestCase):
    def test_fora_de_projeto_gstack_fica_passivo(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = run_hook(global_config_write(tmp), cwd=tmp)
            self.assertEqual(r.returncode, 0)
            self.assertNotIn("CHALLENGE", r.stdout, "fora de projeto gstack o gate nao age")

    def test_alto_risco_em_projeto_gstack_nega_com_challenge(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "proj"
            mark_project(proj)
            deny = json.dumps({"decision": "deny", "rule": "global-config-write",
                               "howTo": "gstack_vibehard challenge evaluate --evidence x"})
            stub = make_stub_cli(tmp, deny)
            r = run_hook(global_config_write(str(proj)), cwd=str(proj),
                         extra_env={"GSTACK_CLI_BIN": str(stub)})
            self.assertEqual(r.returncode, 0, "deny sai via JSON de permissao, exit 0")
            out = json.loads(r.stdout)
            self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertIn("CHALLENGE", out["hookSpecificOutput"]["permissionDecisionReason"])
            self.assertIn("challenge evaluate", out["hookSpecificOutput"]["permissionDecisionReason"])

    def test_grant_allow_deixa_passar(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "proj"
            mark_project(proj)
            allow = json.dumps({"decision": "allow", "risk": "high", "grantedBy": "sha256:x"})
            stub = make_stub_cli(tmp, allow)
            r = run_hook(global_config_write(str(proj)), cwd=str(proj),
                         extra_env={"GSTACK_CLI_BIN": str(stub)})
            self.assertEqual(r.returncode, 0)
            self.assertNotIn("permissionDecision", r.stdout, "allow nao emite decisao (segue o fluxo)")

    def test_cli_ausente_fail_open(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "proj"
            mark_project(proj)
            # PATH sem gstack_vibehard + sem GSTACK_CLI_BIN → gate nao age (fail-open)
            r = run_hook(global_config_write(str(proj)), cwd=str(proj),
                         extra_env={"GSTACK_CLI_BIN": "", "PATH": tmp})
            self.assertEqual(r.returncode, 0)
            self.assertNotIn("CHALLENGE", r.stdout)

    def test_cli_quebrada_fail_open(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "proj"
            mark_project(proj)
            stub = make_stub_cli(tmp, "isto nao e json")
            r = run_hook(global_config_write(str(proj)), cwd=str(proj),
                         extra_env={"GSTACK_CLI_BIN": str(stub)})
            self.assertEqual(r.returncode, 0, "saida ilegivel da CLI nunca bloqueia (fail-open)")
            self.assertNotIn("CHALLENGE", r.stdout)

    def test_escrita_comum_nao_invoca_challenge(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "proj"
            mark_project(proj)
            # arquivo de projeto normal: nem parece config global → gate nem roda a CLI
            inp = {"tool_name": "Write", "tool_input": {"file_path": str(proj / "src" / "app.js")}, "cwd": str(proj)}
            stub = make_stub_cli(tmp, json.dumps({"decision": "deny", "rule": "x", "howTo": "y"}))
            r = run_hook(inp, cwd=str(proj), extra_env={"GSTACK_CLI_BIN": str(stub)})
            self.assertEqual(r.returncode, 0)
            self.assertNotIn("CHALLENGE", r.stdout, "arquivo de projeto nao e alto risco")


if __name__ == "__main__":
    unittest.main()
