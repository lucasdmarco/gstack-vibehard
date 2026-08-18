#!/usr/bin/env python3
"""PermissionRequest hook: auto-aprova comando seguro -- e SO ele.

TRES REGRAS, e as tres nasceram de bypass real (certificacao RC, 2026-08-17):

  1. POR SEGMENTO. `re.match` ancora no inicio, entao `ls && cat .env` casava
     `^ls` e o comando INTEIRO era auto-aprovado. Agora todo segmento precisa
     ser seguro; um so desconhecido derruba a aprovacao do conjunto.
  2. SEM INTERPRETADOR GENERICO. `node -e`, `python -c` e `npx` executam codigo
     arbitrario -- autoriza-los e autorizar qualquer coisa, e uma allowlist que
     os contem nao e allowlist.
  3. NAO DECIDIR != AUTORIZAR. Quando nada casa, o hook sai SEM decisao e o
     fluxo normal de aprovacao humana assume. E o unico caminho seguro para o
     desconhecido, e vale igual para input malformado.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _cmdsec import segmentos, le_segredo, eh_interpretador

# Comandos de LEITURA e de build que nao executam codigo arbitrario nem tocam
# credencial. Cada entrada foi mantida por ser verificavel pelo nome do binario
# mais o subcomando -- nao por "parecer inofensiva".
#
# SAIRAM, e o motivo de cada uma:
#   cat/type      leem qualquer arquivo, inclusive `.env` (regra 2 do modelo)
#   node/python   interpretador generico (regra 2)
#   npx           executa pacote arbitrario da rede
#   npm install   cadeia de suprimentos sem revisao
#   echo          `echo x > arquivo` escreve
#   git add/commit/push/pull   alteram historico ou tocam a rede
SAFE_PATTERNS = [
    r"^npm (run|test|build|lint|typecheck)\b",
    r"^npm (ls|list|outdated|why)\b",
    r"^git (status|diff|log|branch|show|remote -v)\b",
    r"^git checkout\s+-b\s+[\w./-]+$",
    r"^(dir|ls|pwd|Get-ChildItem|Get-Location)\b",
]
# `node --version` NAO tem entrada aqui, de proposito. Seria inofensivo, e a
# excecao custaria mais do que vale: a trava de interpretador precisa ser
# ABSOLUTA para ser legivel, e uma allowlist com "interpretador, menos
# quando..." convida a proxima excecao. O padrao existiu e era INALCANCAVEL --
# a trava dispara antes --, o que e pior que ausente: parece cobertura.


def segmento_seguro(seg):
    """Um segmento so e seguro se casar a allowlist E nao acionar nenhuma trava."""
    if le_segredo(seg) or eh_interpretador(seg):
        return False
    return any(re.match(p, seg) for p in SAFE_PATTERNS)


def permitir():
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "allow"},
        }
    }))
    sys.exit(0)


def nao_decidir():
    """Sai sem decisao: o fluxo normal de aprovacao assume.

    NAO e negar, e nao e permitir. E a resposta honesta para o desconhecido --
    e a mesma para input que o hook nao conseguiu ler, porque nos dois casos
    ele nao sabe sobre o que estaria decidindo.
    """
    sys.exit(0)


def main():
    try:
        inp = json.loads(sys.stdin.read())
        cmd = inp.get("tool_input", {}).get("command", "")
    except Exception:
        # Input ilegivel: nao ha comando sobre o qual decidir.
        return nao_decidir()

    segs = segmentos(cmd)
    if not segs:
        return nao_decidir()
    if all(segmento_seguro(s) for s in segs):
        return permitir()
    return nao_decidir()


if __name__ == "__main__":
    main()
