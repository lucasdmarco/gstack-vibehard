# Chronicle Skill

Memória persistente entre sessões do Codex usando hooks com busca indexada.

## Como funciona

1. **Stop hook**: salva resumo da sessão + palavras-chave em `~/.codex/chronicle/`
2. **SessionStart hook**: constrói índice de busca sobre **todos** os arquivos `.md` do chronicle e injeta como contexto:
   - Última sessão (sempre)
   - Memórias relacionadas ao projeto atual (via busca por substring em project/cwd/summary)
3. **gc.py (GStack Check)**: usa o mesmo índice para mostrar memórias relevantes no diagnóstico
4. **Busca indexada**: arquivos são escaneados e pontuados por relevância (project: +3, summary: +2, cwd: +1)
5. **Keywords**: extraídas automaticamente do resumo da sessão no Stop e salvas na nota

## Arquitetura

O índice é construído em memória a cada SessionStart (sem SQLite, zero dependências). Cada entrada contém:
- `file`: nome do arquivo
- `project`: nome do projeto
- `cwd`: working directory
- `summary`: resumo (até 500 chars)
- `mtime`: timestamp de modificação

## Hooks usados

- `SessionStart` (matcher: `startup|resume`) — constrói índice + busca + injeta contexto
- `Stop` — salva resumo + keywords + QG L1 log-only

## Arquivos relevantes

- `~/.codex/chronicle/` — notas `.md` por sessão
- `~/.codex/hooks/session_start.py` — índice + busca
- `~/.codex/hooks/stop.py` — salvamento com keywords
- `~/.codex/hooks/gc.py` — diagnóstico com chronicle

Ver hooks ativos: `/hooks`
