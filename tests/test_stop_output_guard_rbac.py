"""PRD51 S51.6.5 -- controle negativo REAL do caminho POS-HOC do Output Guard
(hooks/hooks/_output_guard.py output_guard() + stop.py scan_agent_transcript()).

Achado: redact_proxy.test.js/guard_status.test.js so provam o caminho PRE-RENDER
(proxy opt-in). O caminho pos-hoc -- que roda em TODO turno, sem opt-in, via
stop.py -- nunca tinha teste nenhum invocando output_guard() de verdade. Este
teste roda o hook REAL (subprocess), com um transcript.jsonl real contendo um
segredo, e prova RBAC de ponta a ponta: viewer bloqueado, admin nao bloqueado,
transcript limpo nao bloqueado (sem falso-positivo).
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
STOP = REPO_ROOT / "hooks" / "hooks" / "stop.py"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _marker import mark_project  # noqa: E402

SENSITIVE_LINE = json.dumps({
    "role": "assistant",
    "content": "aqui esta a chave: sk_live_51H8x9K2mN4pQ7rS0tU3vW6yZ1aB4cD7eF0gH3iJ6kL9m",
})


def write_transcript(path, line):
    path.write_text(line + "\n", encoding="utf-8")


def run_stop(payload, home, extra_env=None, timeout=30):
    env = os.environ.copy()
    env["GSTACK_AUDIO_CUES_TEST"] = "1"
    env["HOME"] = str(home)
    env["USERPROFILE"] = str(home)
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, str(STOP)],
        input=json.dumps(payload), capture_output=True, text=True,
        env=env, timeout=timeout,
    )


class StopOutputGuardRbacTest(unittest.TestCase):
    def test_viewer_role_com_segredo_no_transcript_e_bloqueado(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            root.mkdir()
            mark_project(root)
            home.mkdir()
            (root / "package.json").write_text("{}\n", encoding="utf-8")
            transcript = Path(tmp) / "transcript.jsonl"
            write_transcript(transcript, SENSITIVE_LINE)

            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "feito", "flags": {}, "transcript_path": str(transcript)},
                home, extra_env={"GSTACK_USER_ROLE": "viewer"},
            )
            # bloqueio real sinaliza pro harness via exit != 0 (stop.py:1347) --
            # nao e um erro, e a CONVENCAO de "block" do hook.
            self.assertEqual(result.returncode, 1, result.stderr)
            data = json.loads(result.stdout)
            self.assertTrue(data.get("blocked"), f"viewer com segredo no transcript deveria ser bloqueado: {data}")
            self.assertEqual(data.get("decision"), "block")
            self.assertIn("Porteiro", data.get("systemMessage", ""))

    def test_admin_role_com_o_MESMO_segredo_NAO_e_bloqueado(self):
        """Prova que o bloqueio é RBAC de verdade (role_level>=3 tem bypass), não
        um filtro cego que bloqueia qualquer segredo pra todo mundo."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            root.mkdir()
            mark_project(root)
            home.mkdir()
            (root / "package.json").write_text("{}\n", encoding="utf-8")
            transcript = Path(tmp) / "transcript.jsonl"
            write_transcript(transcript, SENSITIVE_LINE)

            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "feito", "flags": {}, "transcript_path": str(transcript)},
                home, extra_env={"GSTACK_USER_ROLE": "admin"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertFalse(data.get("blocked"), f"admin (role_level 3) tem bypass do Porteiro: {data}")

    def test_transcript_limpo_viewer_NAO_e_bloqueado_sem_falso_positivo(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            root.mkdir()
            mark_project(root)
            home.mkdir()
            (root / "package.json").write_text("{}\n", encoding="utf-8")
            transcript = Path(tmp) / "transcript.jsonl"
            write_transcript(transcript, json.dumps({"role": "assistant", "content": "arquivo criado com sucesso, sem segredos aqui."}))

            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "feito", "flags": {}, "transcript_path": str(transcript)},
                home, extra_env={"GSTACK_USER_ROLE": "viewer"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertFalse(data.get("blocked"), f"transcript limpo nunca deveria bloquear: {data}")


if __name__ == "__main__":
    unittest.main()
