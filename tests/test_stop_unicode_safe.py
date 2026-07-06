import re
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
STOP = REPO_ROOT / "hooks" / "hooks" / "stop.py"


def _load_safe_write_text():
    """Extrai APENAS safe_write_text do stop.py (o módulo é um script de hook —
    importar executaria o hook inteiro)."""
    src = STOP.read_text(encoding="utf-8")
    match = re.search(r"^def safe_write_text.*?(?=^def )", src, re.S | re.M)
    assert match, "safe_write_text presente no stop.py"
    ns = {"Path": Path}
    exec(compile(match.group(0), str(STOP), "exec"), ns)
    return ns["safe_write_text"]


class StopUnicodeSafeTest(unittest.TestCase):
    def test_surrogate_solto_nao_derruba_o_hook(self):
        """Regressão (revisão pós-PRD25 P1): transcript com surrogate solto causava
        UnicodeEncodeError('surrogates not allowed') e a memória era perdida."""
        safe_write_text = _load_safe_write_text()
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "chronicle.md"
            poisoned = "memoria ok \ud83d inicio-de-emoji-quebrado \ud800 fim"
            safe_write_text(target, poisoned)  # NÃO pode lançar
            saved = target.read_text(encoding="utf-8")
            self.assertIn("memoria ok", saved)
            self.assertIn("fim", saved, "conteúdo ao redor do caractere inválido é preservado")

    def test_texto_normal_permanece_intacto(self):
        safe_write_text = _load_safe_write_text()
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "chronicle.md"
            text = "linha 1\náçêntos e emoji válido \U0001f600\n"
            safe_write_text(target, text)
            self.assertEqual(target.read_text(encoding="utf-8"), text)

    def test_stop_nao_usa_mais_write_text_cru_para_chronicle(self):
        """Guard: os writes de chronicle devem passar pelo safe_write_text."""
        src = STOP.read_text(encoding="utf-8")
        for line in src.splitlines():
            if "chronicle_file" in line and ".write_text(" in line:
                self.fail(f"chronicle escrito sem safe_write_text: {line.strip()}")


if __name__ == "__main__":
    unittest.main()
