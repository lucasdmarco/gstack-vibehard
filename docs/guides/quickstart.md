# Quickstart — 5 minutos, sem medo

Trilha recomendada: **um caminho só**. `start`/`consult` decidem por você.

```bash
# 0) Instalar o CLI (ou use npx sem instalar)
npm install -g @gstack-vibehard/installer

# 1) Ajuda — NUNCA instala nem escreve nada
gstack_vibehard --help

# 2) Trilha guiada: objetivo → consult (read-only) → plano → execução confirmada
gstack_vibehard start

# OU o caminho manual equivalente:
gstack_vibehard consult "quero um SaaS com login e Stripe"   # recomendação read-only
gstack_vibehard create meu-app                               # lite: escreve SÓ ./meu-app
cd meu-app && gstack_vibehard dev                            # sobe o runtime (stop/logs/open)

# 3) A pergunta que importa — "está pronto?" em UM comando:
gstack_vibehard proof --json     # verify + dream audit + readiness + graphify + git
                                 # ready:true = todos os gates determinísticos verdes
```

**Economia de contexto (recomendado antes de mexer em código):** peça ao agente para
rodar `gstack_vibehard context scout "<tema>" --json` — retorna arquivos/linhas
relevantes (read-only, com estimativa de tokens evitados) em vez de abrir 40 arquivos.

## O que cada comando promete

- `--help`, `doctor`, `consult`, `install --audit-only`, `create --dry-run`: **read-only** — zero escrita.
- `create` (lite, default): escreve só `./<nome>`; nasce com git, `.gitignore` com `.env` fora, Runtime Manifest e `.gstack/` local.
- `install` (global): **preflight-first** — mostra o impacto por categoria e pede confirmação; tudo com backup + manifest ([desfazer](reset-uninstall.md)).

## Termos que vão aparecer

- **harness**: o agente/IDE de IA (Claude Code, Cursor, OpenCode, Codex...) — [matriz honesta](harness-matrix.md)
- **QG (Quality Gate)**: auditoria determinística (Fallow) que decide "pronto" — LLM nunca aprova sozinho
- **routed × callable**: `callable` = a ferramenta responde quando chamada; `routed` = o tráfego do harness passa por ela DE FATO (Headroom só "economiza" quando routed — e isso é opt-in)
- **enforced × advisory/instrucional**: `enforced` = hook real bloqueia ANTES da ação; `advisory`/`instrucional` = orientação que o agente pode ignorar — nunca vendido como Zero-Trust
- **manifest**: registro de toda escrita global — é o que torna o `uninstall` restaurativo
- **worktree**: cópia isolada do repo onde agentes trabalham sem tocar seu branch
- **MCP**: servidores de ferramentas dos harnesses — inventário: `tools mcp inventory`
- **Headroom/Graphify/Fallow**: compressão de contexto · AST cache · auditoria estática (Rust)

Próximo: [caminhos de instalação](install-paths.md) · Aprender AI-driven dev na prática:
[Trilha AI-Driven Dev](../../.docs/TRAILS/ai-driven-dev/01-nova-stack-do-dev.md) (5 aulas,
comandos reais, **nada é instalado**).
