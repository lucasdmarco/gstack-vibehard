"""Regressao: por padrao o Stop nao roda fallow audit/QG (timeout em todo turno)
nem cria branch/commit automatico. Ambos sao opt-in."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
STOP = REPO_ROOT / "hooks" / "hooks" / "stop.py"


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


class StopNonIntrusiveTest(unittest.TestCase):
    def test_default_stop_is_fast_and_skips_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            root.mkdir()
            home.mkdir()
            (root / "package.json").write_text("{}\n", encoding="utf-8")

            start = time.time()
            result = run_stop(
                {"cwd": str(root), "last_assistant_message": "feito", "flags": {}},
                home, timeout=25,
            )
            elapsed = time.time() - start
            self.assertEqual(result.returncode, 0, result.stderr)
            # Sem auditoria, o Stop nao deve gastar dezenas de segundos
            self.assertLess(elapsed, 20, f"Stop demorou {elapsed:.1f}s (audit deveria estar off)")
            data = json.loads(result.stdout)
            self.assertIn("systemMessage", data)
            # Nao deve anunciar QG executado por padrao
            self.assertNotIn("QG executado", data.get("systemMessage", ""))

    def test_default_stop_does_not_autocommit(self):
        """Cria um repo git com um .md novo; sessao 'bem-sucedida' nao deve commitar."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            home = Path(tmp) / "home"
            root.mkdir()
            home.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=root, capture_output=True)
            subprocess.run(["git", "config", "user.email", "t@t.co"], cwd=root, capture_output=True)
            subprocess.run(["git", "config", "user.name", "t"], cwd=root, capture_output=True)
            (root / "package.json").write_text("{}\n", encoding="utf-8")
            (root / "NOTES.md").write_text("# notas\n", encoding="utf-8")

            run_stop(
                {"cwd": str(root), "last_assistant_message": "documentacao pronta", "flags": {}},
                home, timeout=25,
            )
            # Nenhum branch gstack/auto-* deve ter sido criado
            branches = subprocess.run(["git", "branch", "--list", "gstack/*"],
                                      cwd=root, capture_output=True, text=True)
            self.assertEqual(branches.stdout.strip(), "", "Stop nao deve criar branch automatico por padrao")
            # Nenhum commit deve existir (repo recem-criado)
            log = subprocess.run(["git", "log", "--oneline"], cwd=root, capture_output=True, text=True)
            self.assertEqual(log.stdout.strip(), "", "Stop nao deve commitar automaticamente por padrao")


if __name__ == "__main__":
    unittest.main()
