import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEEP_RESEARCH = REPO_ROOT / "scripts" / "scripts" / "deep_research.py"


class DeepResearchTest(unittest.TestCase):
    def test_generates_mission_dossier_and_prints_only_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd = Path(tmp)
            result = subprocess.run(
                [sys.executable, str(DEEP_RESEARCH), "Atualizacoes do React 19"],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=20,
            )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            output = result.stdout.strip()
            self.assertTrue(output.endswith(".md"), output)

            dossier = cwd / output
            self.assertTrue(dossier.exists(), output)
            self.assertEqual(dossier.parent, cwd / ".gstack" / "research")
            text = dossier.read_text(encoding="utf-8")
            self.assertIn("# Dossie de Missao: Atualizacoes do React 19", text)
            self.assertIn("Playwright MCP", text)
            self.assertIn("Context7", text)
            self.assertIn("Headroom", text)
            self.assertIn("compressao de texto", text)
            self.assertIn("Nao sintetizar antes de comprimir", text)

    def test_missing_query_returns_json_error_on_stdout(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                [sys.executable, str(DEEP_RESEARCH)],
                cwd=tmp,
                capture_output=True,
                text=True,
                timeout=20,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stderr, "")
            data = json.loads(result.stdout)
            self.assertFalse(data["ok"])
            self.assertIn("query", data["error"].lower())


if __name__ == "__main__":
    unittest.main()
