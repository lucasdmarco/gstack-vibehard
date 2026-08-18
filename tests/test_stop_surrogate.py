#!/usr/bin/env python3
"""Um caractere invalido nao pode custar a sessao inteira.

O hook OFICIAL de Stop executou e MORREU com `UnicodeEncodeError: surrogates not
allowed`. Nao foi hipotese: rodou, falhou, e a memoria da sessao foi perdida
inteira por causa de um `\\ud83d` solto vindo do transcript.

Um surrogate isolado e um meio-par de UTF-16 que NAO tem representacao em UTF-8.
Ele atravessa o JSON de entrada sem problema (`json` aceita), e explode no
primeiro ponto que codifica: arquivo, stdout ou stderr.

O QUE ESTES TESTES GUARDAM:

  1. o texto CHEGA, com marca visivel de corrupcao (U+FFFD), em vez de sumir;
  2. Unicode VALIDO passa intacto -- sanear nao pode degradar o caso comum;
  3. o hook segue NAO BLOQUEANTE: erro registrado, turno preservado.
"""

import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
HOOKS = RAIZ / "hooks" / "hooks"
sys.path.insert(0, str(HOOKS))

from _harness import sem_surrogates, escrita_segura  # noqa: E402

SURROGATE = "\ud83d"


class Saneamento(unittest.TestCase):

    def test_NEGATIVO_surrogate_isolado_vira_texto_codificavel(self):
        r = sem_surrogates("antes %s depois" % SURROGATE)
        r.encode("utf-8")  # nao pode levantar
        self.assertIn("antes", r)
        self.assertIn("depois", r, "o texto em volta do caractere ruim precisa sobreviver")
        self.assertIn("�", r, "e a corrupcao precisa ficar VISIVEL, nao silenciosa")

    def test_POSITIVO_unicode_valido_passa_intacto(self):
        for valido in ["acentuacao ~ cedilha", "emoji \U0001f600", "CJK 中文",
                       "matematico ∑", ""]:
            with self.subTest(t=valido):
                self.assertEqual(sem_surrogates(valido), valido,
                                 "sanear nao pode degradar o caso comum")

    def test_nao_string_atravessa_sem_conversao(self):
        for v in [None, 42, {"a": 1}, ["x"]]:
            with self.subTest(v=v):
                self.assertIs(sem_surrogates(v), v)

    def test_escrita_segura_nunca_levanta(self):
        buf = io.StringIO()
        escrita_segura(buf, "ok %s fim" % SURROGATE)
        self.assertIn("ok", buf.getvalue())

        class FluxoQueSempreQuebra:
            def write(self, _):
                raise UnicodeEncodeError("utf-8", "", 0, 1, "forcado")

        # Nem um fluxo que sempre falha pode derrubar o hook.
        escrita_segura(FluxoQueSempreQuebra(), "qualquer coisa")


class ChronicleSobrevive(unittest.TestCase):
    """A gravacao do chronicle e o ponto onde a memoria era perdida."""

    def test_gravacao_com_surrogate_produz_arquivo_legivel(self):
        sys.path.insert(0, str(HOOKS))
        alvo = Path(tempfile.mkdtemp()) / "chronicle.md"
        texto = "# Sessao\n\nnota com %s no meio\n" % SURROGATE

        # Mesma cadeia do hook: sanear e entao gravar.
        alvo.write_text(sem_surrogates(texto), encoding="utf-8", errors="replace")

        lido = alvo.read_text(encoding="utf-8")
        self.assertIn("# Sessao", lido)
        self.assertIn("no meio", lido, "a nota inteira precisa estar la")

    def test_o_hook_SANEIA_antes_de_gravar_e_nao_so_no_encoding(self):
        """`errors=replace` resolveria a gravacao e deixaria o surrogate no texto.

        Sanear ANTES fecha a cadeia: o proximo consumidor do mesmo texto -- outro
        hook, um indexador, um relatorio -- nao herda o caractere que quebra.
        """
        fonte = (HOOKS / "stop.py").read_text(encoding="utf-8")
        self.assertIn("surrogatepass", fonte)
        self.assertIn("safe_write_text", fonte)


class NaoBloqueante(unittest.TestCase):
    """O hook de Stop roda em TODO turno: erro dele nao pode quebrar o turno."""

    def test_stop_com_transcript_corrompido_sai_limpo(self):
        payload = json.dumps({
            "cwd": tempfile.mkdtemp(),
            "last_assistant_message": "resposta com %s solto" % SURROGATE,
        })
        r = subprocess.run(
            [sys.executable, str(HOOKS / "stop.py")],
            input=payload, capture_output=True, text=True, timeout=120,
            encoding="utf-8", errors="replace",
        )
        self.assertEqual(r.returncode, 0,
                         "hook de parada nao pode derrubar o turno por caractere invalido")
        if r.stdout.strip():
            json.loads(r.stdout)  # o que sair precisa ser documento valido


if __name__ == "__main__":
    unittest.main()
