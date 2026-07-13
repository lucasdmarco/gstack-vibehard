"""Ativação POR PROJETO + fail-open (PRD v2.27.0).

Infra dos hooks é global, mas as regras gstack só agem em projeto com `.gstack/`.
Hooks globais nunca podem crashar/travar o turno (fail-open)."""
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

from _paths import find_gstack_root, is_gstack_project, write_project_marker  # noqa: E402


def run_hook(name, stdin_text, cwd=None):
    return subprocess.run(
        [sys.executable, str(HOOKS / name)],
        input=stdin_text, capture_output=True, text=True, timeout=60,
        cwd=cwd,
    )


class FindGstackRootTest(unittest.TestCase):
    def test_projeto_com_gstack_MARCADO_detectado(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = (Path(tmp) / "proj").resolve()
            (proj / "src").mkdir(parents=True)
            write_project_marker(proj)  # marcador canônico gstack.project.v1
            self.assertEqual(find_gstack_root(str(proj / "src")), proj)
            self.assertTrue(is_gstack_project(str(proj)))

    def test_gstack_SEM_marcador_permanece_inerte(self):
        # PRD41 S41.2 / P0.3: `.gstack/` vazado/copiado (sem project.json válido)
        # NÃO ativa — como o %TEMP%/.gstack que furava projetos alheios.
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "vazado"
            (proj / ".gstack").mkdir(parents=True)  # bare, sem marcador
            self.assertIsNone(find_gstack_root(str(proj)))
            self.assertFalse(is_gstack_project(str(proj)))

    def test_marcador_com_root_divergente_nao_ativa(self):
        # root canônico do marcador tem que corresponder ao diretório (anti-cópia).
        with tempfile.TemporaryDirectory() as tmp:
            proj = (Path(tmp) / "proj").resolve()
            write_project_marker(proj)
            moved = Path(tmp) / "movido"
            (proj).rename(moved)  # marcador aponta pro root antigo → inválido no novo
            self.assertIsNone(find_gstack_root(str(moved)))

    def test_projeto_sem_gstack_retorna_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "alheio"
            proj.mkdir(parents=True)
            self.assertIsNone(find_gstack_root(str(proj)))
            self.assertFalse(is_gstack_project(str(proj)))

    def test_home_dir_NAO_e_projeto(self):
        # ~/.gstack é o dir GLOBAL, não marcador de projeto: home não conta.
        self.assertIsNone(find_gstack_root(str(Path.home())))

    def test_cwd_vazio(self):
        self.assertIsNone(find_gstack_root(""))


class FailOpenTest(unittest.TestCase):
    def test_pre_tool_use_stdin_malformado_nao_bloqueia(self):
        r = run_hook("pre_tool_use_security.py", "isso nao e json {{{")
        self.assertEqual(r.returncode, 0, "input malformado deve LIBERAR (exit 0), nao bloquear")

    def test_user_prompt_submit_stdin_malformado_exit0(self):
        r = run_hook("user_prompt_submit.py", "")
        self.assertEqual(r.returncode, 0)

    def test_stop_stdin_malformado_exit0(self):
        r = run_hook("stop.py", "nao-json")
        self.assertEqual(r.returncode, 0)

    def test_pre_tool_use_bloqueia_destrutivo_global(self):
        # rede de seguranca: comando destrutivo bloqueado mesmo fora de projeto gstack
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}})
        r = run_hook("pre_tool_use_security.py", payload)
        # deny é emitido (stdout com permissionDecision/deny) — não exit 0 silencioso
        self.assertIn("deny", (r.stdout + r.stderr).lower())


class PerProjectGateTest(unittest.TestCase):
    def test_stop_em_projeto_SEM_gstack_nao_salva_chronicle(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "alheio"
            proj.mkdir(parents=True)
            payload = json.dumps({"cwd": str(proj), "last_assistant_message": "feito", "flags": {}})
            r = run_hook("stop.py", payload, cwd=str(proj))
            self.assertEqual(r.returncode, 0)
            self.assertNotIn("Memorias salvas", r.stdout + r.stderr, "sem .gstack/ não salva chronicle")

    def test_session_start_SEM_gstack_nao_injeta_identidade(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "alheio"
            proj.mkdir(parents=True)
            payload = json.dumps({"cwd": str(proj)})
            r = run_hook("session_start.py", payload, cwd=str(proj))
            self.assertEqual(r.returncode, 0)
            self.assertNotIn("Identity & Standard", r.stdout, "sem .gstack/ não injeta identidade gstack")


if __name__ == "__main__":
    unittest.main()
