import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
QG = REPO_ROOT / "hooks" / "hooks" / "qg.py"


def _write_fake_launchers(fake_bin, fake_runner):
    """Fakeia `npx` E `fallow` apontando para o runner (mesma ordem de resolução
    real: fallow local/global vence npx). Espelha test_qg_fallow_wrapper.py."""
    for name in ("npx", "fallow"):
        if os.name == "nt":
            launcher = fake_bin / f"{name}.cmd"
            launcher.write_text(
                "@echo off\r\n"
                f"\"{sys.executable}\" \"{fake_runner}\" %*\r\n"
                "exit /b %ERRORLEVEL%\r\n",
                encoding="utf-8",
            )
        else:
            launcher = fake_bin / name
            launcher.write_text(
                "#!/usr/bin/env sh\n"
                f"exec \"{sys.executable}\" \"{fake_runner}\" \"$@\"\n",
                encoding="utf-8",
            )
            launcher.chmod(0o755)


class QgFailClosedTest(unittest.TestCase):
    """PRD41 S41.1 / PRD40 P0.1 — falha da ferramenta é falha do gate. O Fallow que
    não CONCLUI uma análise (erro operacional, payload de erro, exit sem achados)
    nunca pode produzir pass:true."""

    def _run(self, payload, exit_code, extra_args=None):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)  # P0.4: sem vazar temp
        tmp_path = Path(tmp)
        fake_bin = tmp_path / "bin"
        fake_bin.mkdir()
        fake_runner = fake_bin / "fake_runner.py"
        # payload=None → runner imprime NADA (stdout vazio); senão imprime o JSON.
        body = "" if payload is None else f"print(json.dumps({payload!r}))\n"
        fake_runner.write_text(
            "import json, sys\n" + body + f"sys.exit({exit_code})\n",
            encoding="utf-8",
        )
        _write_fake_launchers(fake_bin, fake_runner)
        env = os.environ.copy()
        env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")
        args = [sys.executable, str(QG), "--path", str(tmp_path), "--level", "1"] + (extra_args or [])
        return subprocess.run(args, capture_output=True, text=True, env=env, timeout=20)

    def test_defect_p01_exit2_empty_findings_is_tool_failed(self):
        """O DEFEITO exato do P0.1: Fallow sai 2 com payload de erro e ZERO findings.
        Antes → pass:true (lista vazia de blockers). Agora → tool_failed, exit 1."""
        payload = {"error": True, "message": "failed to create worktree", "findings": []}
        r = self._run(payload, 2)
        data = json.loads(r.stdout)
        self.assertFalse(data["pass"], r.stdout)
        self.assertEqual(data["verdict"], "tool_failed")
        self.assertEqual(r.returncode, 1)
        self.assertIn("error=true", data["reason"].lower().replace(" ", "") or data["reason"])

    def test_exit2_even_with_findings_is_tool_failed(self):
        """Exit >=2 é erro operacional do Fallow — bloqueia mesmo com achados."""
        payload = {"issues": [{"rule": "x", "severity": "MEDIO", "auto_fixable": True}]}
        r = self._run(payload, 2)
        data = json.loads(r.stdout)
        self.assertEqual(data["verdict"], "tool_failed")
        self.assertEqual(r.returncode, 1)

    def test_error_verdict_exit0_is_tool_failed(self):
        """Payload com verdict=error mesmo saindo 0 → tool_failed (não confia)."""
        payload = {"verdict": "error", "issues": []}
        r = self._run(payload, 0)
        data = json.loads(r.stdout)
        self.assertEqual(data["verdict"], "tool_failed")
        self.assertEqual(r.returncode, 1)

    def test_exit1_zero_findings_is_tool_failed(self):
        """Exit não-zero SEM nenhum achado que o explique → análise não concluída."""
        payload = {"issues": []}
        r = self._run(payload, 1)
        data = json.loads(r.stdout)
        self.assertEqual(data["verdict"], "tool_failed")
        self.assertEqual(r.returncode, 1)

    def test_clean_exit0_zero_findings_still_passes(self):
        """Projeto genuinamente limpo (exit 0, zero achados) NÃO é tool_failed."""
        payload = {"verdict": "pass", "issues": []}
        r = self._run(payload, 0)
        data = json.loads(r.stdout)
        self.assertTrue(data["pass"], r.stdout)
        self.assertEqual(data["verdict"], "pass")
        self.assertEqual(r.returncode, 0)

    def test_top_level_list_is_valid_not_tool_failed(self):
        """Saída lista (container de achados) é válida — não vira 'schema desconhecido'."""
        payload = [{"rule": "x", "severity": "MEDIO", "auto_fixable": True}]
        r = self._run(payload, 1)  # exit 1 COM achados = quality ok (MEDIO não bloqueia)
        data = json.loads(r.stdout)
        self.assertTrue(data["pass"], r.stdout)
        self.assertEqual(r.returncode, 0)

    def test_tool_failed_blocks_even_without_strict(self):
        """tool_failed bloqueia mesmo sem --strict (falha de ferramenta = falha do gate)."""
        r = self._run({"error": True, "findings": []}, 2)  # sem --strict
        self.assertEqual(r.returncode, 1)
        self.assertEqual(json.loads(r.stdout)["verdict"], "tool_failed")


if __name__ == "__main__":
    unittest.main()
