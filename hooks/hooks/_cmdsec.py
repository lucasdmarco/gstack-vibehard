#!/usr/bin/env python3
"""Analise de seguranca de comando, compartilhada pelos hooks.

MODELO DE AMEACA (certificacao RC, 2026-08-17). O `P0.CODEX-SECURITY` registrava
"allowlist ampla". A modelagem mostrou seis caminhos concretos, e cinco deles
eram AUTO-APROVADOS sem que ninguem visse:

  1. `cat .env` / `type .env`     leitura direta de segredo
  2. `node -e "...readFileSync"`  interpretador generico = execucao arbitraria
  3. `python -c "..."`            idem
  4. `npm install <pacote>`       cadeia de suprimentos, sem revisao
  5. `ls && cat .env`             comando COMPOSTO: a allowlist so olhava o
                                  primeiro segmento e liberava o resto junto
  6. `git push --force`           destrutivo/rede

O 5o e o mais importante: `re.match` ancora no INICIO, entao qualquer comando
perigoso encostado num prefixo seguro passava inteiro. Uma allowlist que decide
por prefixo nao decide sobre o comando -- decide sobre a primeira palavra dele.

REGRA DESTE MODULO: um comando composto so e seguro se TODO segmento for seguro.
Segmento desconhecido nao e "provavelmente ok": e desconhecido, e a resposta e
NAO DECIDIR -- o que devolve o comando ao fluxo normal de aprovacao humana, e e
diferente de autorizar.
"""

import re

SEGMENT_SCHEMA = "gstack.cmdsec.v1"

# Separadores que encadeiam COMANDOS. `|` entra porque `ls | sh` executa.
_SEPARADORES = re.compile(r"&&|\|\||[;&|\n\r]")


def segmentos(cmd):
    """Segmentos executaveis de um comando composto, sem os vazios."""
    if not isinstance(cmd, str):
        return []
    return [s.strip() for s in _SEPARADORES.split(cmd) if s.strip()]


# ── Leitura de segredo ─────────────────────────────────────────────────────
# Nomes de arquivo que carregam credencial por convencao. Nao e heuristica de
# conteudo: e o nome que o ecossistema usa, e o hook nao abre o arquivo.
_ARQ_SEGREDO = re.compile(
    r"(^|[\s/\\\"'=@:,])"
    r"(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|id_rsa|id_ed25519|"
    r"credentials(\.json)?|secrets?\.(json|yaml|yml|toml|env)|"
    r"\.aws[/\\]credentials|\.ssh[/\\]id_[\w]+)"
    r"($|[\s\"';)])",
    re.IGNORECASE,
)

# Comandos que LEEM conteudo de arquivo e o colocam na saida.
_LEITORES = re.compile(
    r"^\s*(cat|type|more|less|head|tail|strings|xxd|od|"
    r"Get-Content|gc|Select-String|findstr|grep|rg|"
    r"copy|cp|curl|wget|scp)\b",
    re.IGNORECASE,
)


def le_segredo(seg):
    """O segmento le um arquivo de segredo? Nome do arquivo, nunca conteudo."""
    return bool(_LEITORES.match(seg or "")) and bool(_ARQ_SEGREDO.search(seg or ""))


# ── Interpretadores genericos ──────────────────────────────────────────────
# Autorizar um interpretador e autorizar QUALQUER coisa: `node -e`, `python -c`,
# `sh -c` executam codigo arbitrario. Uma allowlist que os contem nao e allowlist.
_INTERPRETADORES = re.compile(
    r"^\s*(node|nodejs|deno|bun|python|python3|py|ruby|perl|php|"
    r"sh|bash|zsh|dash|fish|pwsh|powershell|cmd|osascript|"
    r"npx|uvx|pipx|eval|exec)\b",
    re.IGNORECASE,
)


def eh_interpretador(seg):
    return bool(_INTERPRETADORES.match(seg or ""))


def analisar(cmd):
    """Veredito estrutural do comando, sem decidir politica.

    Devolve `{segments, reads_secret, has_interpreter}`. Quem decide o que fazer
    com isso e o hook -- este modulo so mede.
    """
    segs = segmentos(cmd)
    return {
        "schemaVersion": SEGMENT_SCHEMA,
        "segments": segs,
        "reads_secret": [s for s in segs if le_segredo(s)],
        "has_interpreter": [s for s in segs if eh_interpretador(s)],
    }
