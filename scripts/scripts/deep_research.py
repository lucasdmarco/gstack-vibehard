#!/usr/bin/env python3
"""Generate a CLI-first Deep Research mission dossier.

This script does not browse the web directly. It produces a deterministic
Markdown plan that instructs the research agent to use Playwright MCP,
Context7, and Headroom before synthesis.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


RESEARCH_DIR = Path(".gstack") / "research"


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:80] or "research"


def validate_query(argv: list[str]) -> str:
    query = " ".join(arg.strip() for arg in argv if arg.strip()).strip()
    if not query:
        raise ValueError("query argument is required")
    return query


def build_dossier(query: str, created_at: datetime) -> str:
    iso_time = created_at.isoformat()
    return f"""# Dossie de Missao: {query}

**Criado em:** {iso_time}
**Modo:** Deep Research Local, CLI-first, agnostico de provider

## Objetivo

Investigar profundamente: **{query}**.

O agente principal nao deve adivinhar respostas. Ele deve executar a pesquisa via MCPs, coletar evidencias, comprimir material bruto e so entao sintetizar.

## Ferramentas Obrigatorias

1. **Playwright MCP**
   - Navegar em fontes primarias e secundarias.
   - Abrir documentacao oficial, changelogs, issues relevantes, repositorios e artigos tecnicos.
   - Capturar paginas dinamicas quando a informacao depender de JavaScript.

2. **Context7**
   - Fazer scraping estruturado e extrair trechos relevantes de documentacao e paginas tecnicas.
   - Priorizar fontes com data, versao, autor ou repositorio verificavel.
   - Registrar URLs e contexto suficiente para auditoria posterior.

3. **Headroom**
   - Passar todo resultado massivo pelo funil do Headroom usando compressao de texto antes da sintese.
   - Nao sintetizar antes de comprimir o corpus bruto.
   - Preservar fatos, versoes, datas, comandos, breaking changes e links canonicos.

## Plano de Execucao

1. Definir subperguntas para a pesquisa principal.
2. Usar Playwright MCP para descobrir e navegar fontes.
3. Usar Context7 para extrair conteudo estruturado das melhores fontes.
4. Consolidar o corpus bruto em blocos por tema.
5. Rodar Headroom com compressao de texto sobre cada bloco massivo.
6. Sintetizar somente a partir dos blocos comprimidos e das fontes registradas.
7. Produzir resposta final com:
   - resumo executivo,
   - fatos verificados,
   - divergencias entre fontes,
   - riscos ou incertezas,
   - links de referencia,
   - proximas acoes recomendadas.

## Regras de Qualidade

- Nao usar memoria interna como fonte final.
- Nao misturar conteudo sem URL com conteudo verificado.
- Nao ocultar lacunas; marcar explicitamente o que nao foi confirmado.
- Preferir fontes oficiais e repositorios antes de blogs e redes sociais.
- Todo material longo deve passar pelo Headroom antes da sintese.

## Prompt de Inicializacao para o Agente de Pesquisa

Use este dossie como contrato de execucao. Pesquise `{query}` usando Playwright MCP para navegacao, Context7 para scraping estruturado e Headroom para compressao de texto do corpus bruto antes de qualquer sintese. Retorne uma analise auditavel com referencias e incertezas explicitas.
"""


def create_dossier(query: str, cwd: Path | None = None) -> Path:
    base = cwd or Path.cwd()
    research_dir = base / RESEARCH_DIR
    research_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    filename = f"{now.strftime('%Y%m%d-%H%M%S')}-{slugify(query)}.md"
    dossier = research_dir / filename
    dossier.write_text(build_dossier(query, now), encoding="utf-8")
    return dossier.relative_to(base)


def main(argv: list[str] | None = None) -> int:
    try:
        query = validate_query(argv if argv is not None else sys.argv[1:])
        dossier = create_dossier(query)
        print(dossier.as_posix())
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
