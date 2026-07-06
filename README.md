# 🚀 gstack-vibehard

[![Test](https://github.com/lucasdmarco/gstack-vibehard/actions/workflows/test.yml/badge.svg)](https://github.com/lucasdmarco/gstack-vibehard/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/@gstack-vibehard/installer)](https://www.npmjs.com/package/@gstack-vibehard/installer)

**🌐 Idiomas:** [Português (guia completo)](docs/pt-BR/README.md) · [English (full guide)](docs/en/README.md)

**Pitch de 30 segundos:** um **capacete de segurança** para seus agentes de IA (Claude Code, Cursor, OpenCode, Codex). Roda 100% na sua máquina e dá aos agentes **gates de segurança/qualidade, memória entre sessões e criação de projetos** — sem escrita global escondida e com rollback de verdade.

> O comando é **`gstack_vibehard`** (underscore). O pacote npm é `@gstack-vibehard/installer` (hífen).
> Honestidade: o gstack **não elimina alucinação** — ele adiciona *gates* determinísticos para que um erro do agente não vire estrago.

---

## 🔒 Official sources only

- **npm:** [`@gstack-vibehard/installer`](https://www.npmjs.com/package/@gstack-vibehard/installer)
- **GitHub:** `lucasdmarco/gstack-vibehard`

Qualquer outro lugar é mirror não oficial — trate como risco de malware.

---

## ⚡ Começar sem medo (5 minutos)

```bash
# 1) Ajuda — NÃO instala nem escreve nada:
npx @gstack-vibehard/installer --help

# 2) Trilha recomendada (objetivo → consult read-only → plano → execução confirmada):
npx @gstack-vibehard/installer start

# 3) Ou direto: crie um app (LITE por padrão — escreve SÓ ./meu-app, nada global):
npx @gstack-vibehard/installer create meu-app
cd meu-app && gstack_vibehard dev      # sobe o runtime · stop / logs / open

# 4) Antes de integrar globalmente, veja o impacto SEM escrever:
npx @gstack-vibehard/installer consult "quero um SaaS com login e Stripe"
npx @gstack-vibehard/installer install --audit-only

# 5) "Está pronto?" — o veredito único, determinístico (LLM nunca decide):
gstack_vibehard proof --json    # verify + dream audit + readiness + graphify + git
```

## ☝️ Pick one path only (não empilhe instalações)

Escolha **um** caminho — `consult` recomenda e detecta empilhamento:

| Caminho | Escreve global? |
|---|---|
| `create meu-app` (lite, default) | **Não** — só `./meu-app` |
| `install --project-only` | Mínimo (sem deps/MCP global/vault) |
| `install` completo | Sim — preflight + confirmação; MCP global com opt-out `--no-global-mcp` |

Detalhes: [guia de caminhos de instalação](docs/guides/install-paths.md).

---

## ✨ O que você ganha

- ⛔ **Bloqueio de comando destrutivo** (hooks reais) + **Challenge-Response** para ação de alto risco
- 🧠 **Memória entre sessões** (chronicle) e **contexto indexado** offline
- 🛡️ **Scanner de segredos** no diff; delegação **bloqueia** `.env` rastreado
- 🚀 **Runtime real**: `dev`/`stop`/`logs`/`open` com manifest por projeto
- 🌳 **Worktree lifecycle**: `list/diff/accept/discard/cleanup --dry-run` (estados determinísticos)
- 🔌 **Inventário MCP** multi-harness com secrets redigidos (`tools mcp inventory`)
- 🤖 **Orquestração v2**: executor em worktree + verifier independente + reviewer LLM plugável (advisory) — **LLM nunca aprova sozinho**
- 💭 **Auto-dream com `dream improve`**: plano determinístico → execução isolada em worktree → proposta revisável — **nunca auto-merge**; `dream audit` mede promessa vs evidência (hoje: 20 REAL / 1 PARTIAL / 0 RISK)
- 🔏 **Edit guard hash-anchored** (`tools edit-guard`): valida o trecho antes do patch; stale aborta recuperável com provenance
- 🧩 **MCP runtime-injected project-scoped** (`tools mcp runtime`): registro só no run context, deny-default para destrutivos — nunca `~/.mcp.json` nem config global
- 🕶️ **Redaction pré-render opt-in** (`gstack_vibehard proxy`): segredo mascarado ANTES da tela onde o harness aceita base-URL custom (Claude/Codex/OpenCode) — **não é Zero-Trust universal**
- 🧪 **Prova de máquina limpa**: `npm run proof` — 15 etapas com placar (stress EBUSY 12×, suítes, gates com validação de conteúdo, `verify --profile release`, tarball, `tools clean-machine`)
- 🌐 **Agent Reach** (opt-in): canais de leitura na internet com consentimento por canal

Matriz honesta por harness (hooks reais vs instrucional): [guia](docs/guides/harness-matrix.md) · `agents doctor --json`.

### O que é real, callable, opt-in ou roadmap

Nada de claim inflado: a maturidade de cada capacidade está separada em
**[capacidades](docs/guides/capabilities.md)** (fonte viva: `tools readiness --json`).
Destaque de honestidade: o **Headroom não economiza tokens automaticamente** —
enquanto não estiver `routed`, o estado real é `callable_not_routed`.

### Comece honesto em 3 comandos

```bash
npx @gstack-vibehard/installer start                                    # trilha guiada
node src/index.js context scout "como o projeto funciona?" --json       # índice offline
node src/index.js verify --changed-files --json                         # gate só no que mudou
```

---

## 🔄 Como desfazer

```bash
gstack_vibehard uninstall --dry-run   # plano (sem escrita)
gstack_vibehard uninstall             # rollback via manifest (preserva o que você editou)
```

Tudo que o `install` escreve tem backup + manifest — [guia de reset/uninstall](docs/guides/reset-uninstall.md).

---

## 📚 Documentação

| | |
|---|---|
| [Quickstart](docs/guides/quickstart.md) | 5 minutos, termos explicados |
| [Trilha AI-Driven Dev](.docs/TRAILS/ai-driven-dev/01-nova-stack-do-dev.md) | 5 aulas com comandos reais; onboarding — **nada é instalado** |
| [Capacidades: real/callable/opt-in/roadmap](docs/guides/capabilities.md) | o que o produto entrega hoje, sem inflar |
| [Caminhos de instalação](docs/guides/install-paths.md) | lite vs full, matriz de inclusão/exclusão |
| [Reset & uninstall](docs/guides/reset-uninstall.md) | desfazer de verdade |
| [Matriz de harnesses](docs/guides/harness-matrix.md) | enforcement real vs instrucional |
| [Política MCP](docs/MCP-CONNECTOR-POLICY.md) | quando um MCP vira default |
| [Guia completo PT-BR](docs/pt-BR/README.md) · [English](docs/en/README.md) | referência detalhada |
| [SECURITY](SECURITY.md) · [THREAT_MODEL](THREAT_MODEL.md) · [CONTRIBUTING](CONTRIBUTING.md) | governança |

## 📦 Verificação & qualidade

**Para o usuário:** `gstack_vibehard proof --json` — o veredito único "posso
publicar/entregar?" (`gstack.proof.v1`): verify + dream audit + readiness + graphify
freshness + git tree, `ready:true` só com todos os gates determinísticos verdes.

**Para o desenvolvedor do repo:** `npm run proof` — a prova de máquina limpa inteira
(15 etapas, placar PASS/FAIL, relatório JSON; em falha salva o log completo da etapa).

Individuais: `npm test` (680+ testes) · `npm run test:py` · `npm run lint` ·
`npm run typecheck:ts` (TS baseline real) · `npm run test:pack` (tarball real) ·
`node src/index.js verify --profile release --json` (release gate determinístico) ·
Fallow com **gate por regressão** (baselines commitadas — débito novo reprova) ·
CI em **Linux + Windows + macOS**.

Histórico em **[CHANGELOG.md](CHANGELOG.md)**. Licença **MIT**.

**Pronto para dar um capacete ao seu agente?** 👉 `npx @gstack-vibehard/installer start`
