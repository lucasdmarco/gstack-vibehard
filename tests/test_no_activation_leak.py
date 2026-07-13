"""SENTINELA de vazamento de ativação (PRD41 S41.2 / PRD40 P0.4).

O defeito que motivou o S41.2: um `.gstack` residual de teste sob `%TEMP%` fazia o
`find_gstack_root` — que sobe a árvore — ATIVAR qualquer projeto criado em subpasta do
TEMP, quebrando testes vizinhos e (pior) podendo injetar governança em projeto alheio.

O P0.3 (marcador canônico) já neutraliza um `.gstack` VAZIO vazado. Esta sentinela é a
rede do P0.4: garante que a ÁRVORE DE TEMP não ativa nada — pega inclusive o caso de
alguém vazar um marcador VÁLIDO no TEMP (que o P0.3 sozinho não pegaria)."""
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / "hooks" / "hooks"
sys.path.insert(0, str(HOOKS))

from _paths import find_gstack_root  # noqa: E402


class NoActivationLeakTest(unittest.TestCase):
    def test_temp_tree_nao_ativa_nenhum_projeto(self):
        """Um diretório recém-criado sob o TEMP real NÃO pode ser ativado: se algum
        `.gstack` (vazio OU com marcador) vazou na ancestralidade do TEMP, isto FALHA
        apontando o vazamento — em vez de outro teste quebrar de forma obscura."""
        with tempfile.TemporaryDirectory() as tmp:
            child = Path(tmp) / "a" / "b" / "c"
            child.mkdir(parents=True)
            root = find_gstack_root(str(child))
            self.assertIsNone(
                root,
                f"VAZAMENTO P0.4: find_gstack_root ativou '{root}' a partir da árvore de "
                f"TEMP. Há um `.gstack` residual em algum ancestral de {tmp} — remova-o "
                f"(nenhum teste deve criar `.gstack` fora de um dir isolado com cleanup).",
            )

    def test_system_temp_root_sem_gstack_residual(self):
        """Reforço direto: a RAIZ do TEMP do sistema não deve conter `.gstack`
        residual (o exato artefato que furava a ativação por-projeto)."""
        temp_root_marker = Path(tempfile.gettempdir()) / ".gstack"
        self.assertFalse(
            temp_root_marker.exists(),
            f"VAZAMENTO P0.4: existe `{temp_root_marker}` — resíduo de teste que ativava "
            f"projetos em subpastas do TEMP. Remova-o.",
        )


if __name__ == "__main__":
    unittest.main()
