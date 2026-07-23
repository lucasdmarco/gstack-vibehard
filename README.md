# 🚀 GStack VibeHard

[![Test](https://github.com/lucasdmarco/gstack-vibehard/actions/workflows/test.yml/badge.svg)](https://github.com/lucasdmarco/gstack-vibehard/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/@gstack-vibehard/installer)](https://www.npmjs.com/package/@gstack-vibehard/installer)

**🌐 Idiomas:** [Português (guia completo)](docs/pt-BR/README.md) · [English (full guide)](docs/en/README.md)

## Em uma frase

**Proteja seu agente de IA antes dele mexer no seu projeto.**

Você já usa uma IA para programar (Claude Code, Cursor, Codex, OpenCode…).
O GStack é um **capacete**: você instala uma vez e continua usando sua IA
exatamente como antes. Ele cria projetos, faz verificações antes de dizer
"pronto", guarda a memória do que foi decidido — e **tudo tem desfazer**.

> Instale apenas das fontes oficiais:
> **npm** [`@gstack-vibehard/installer`](https://www.npmjs.com/package/@gstack-vibehard/installer) · **GitHub** `lucasdmarco/gstack-vibehard`.
> O comando no terminal é **`gstack_vibehard`** (com underscore); o pacote npm usa hífen.

## Comece sem medo

```bash
npx @gstack-vibehard/installer --help    # só mostra a ajuda — não escreve NADA
npx @gstack-vibehard/installer start     # assistente guiado: ele pergunta, você decide
```

O `start` conversa com você em passos: o que você quer construir → um plano →
sua confirmação antes de qualquer coisa ser criada. Se se arrepender depois:
`gstack_vibehard uninstall` desfaz o que foi instalado.

## Se você é iniciante

Você **não precisa** entender os termos técnicos para começar. Os únicos
comandos que valem decorar:

| Quero… | Rode… | O que acontece |
|---|---|---|
| Só entender | `npx @gstack-vibehard/installer --help` | Nada é escrito |
| Criar guiado | `npx @gstack-vibehard/installer start` | Pergunta objetivo e confirma antes de agir |
| Criar direto | `npx @gstack-vibehard/installer create meu-app` | Cria só a pasta `./meu-app`, nada global |
| Rodar o app | `gstack_vibehard dev` | Sobe o app local (parar: `stop` · ver: `logs`) |
| "Está pronto?" | `gstack_vibehard proof` | UMA resposta: pronto ou não, com o motivo |
| Desfazer | `gstack_vibehard uninstall --dry-run` | Mostra o plano de remoção antes de tocar em algo |

Se o terminal reclamar de `npm`, não tente consertar na mão:
`gstack_vibehard doctor node` diagnostica e diz o próximo passo.

## Já tenho um projeto

```bash
npx @gstack-vibehard/installer consult "quero proteger este projeto"   # só recomenda, não escreve
npx @gstack-vibehard/installer install --audit-only                    # mostra o impacto SEM instalar
```

A instalação completa só acontece depois disso, com sua confirmação explícita.

## O que o GStack nunca faz sem você pedir

- Não lê nem edita seus arquivos de senha/segredo (`.env`).
- Não altera as configurações globais das suas IAs no modo lite/projeto.
- Não envia seu código para uma nuvem própria — roda 100% na sua máquina.
- Não aceita mudança de IA sem verificação: **uma IA nunca aprova o próprio trabalho**.
- Não instala nada pesado sem mostrar o impacto antes (`--audit-only`).
- Não deixa você sem saída: o que o install escreve tem backup e desfazer.

## Tradução sem jargão

| Termo que você vai ver | O que significa de verdade |
|---|---|
| Quality gate | Checkpoint automático antes de dizer "pronto" |
| Harness | O app de IA que você usa (Claude Code, Cursor, Codex, OpenCode) |
| Worktree | Cópia isolada onde o agente trabalha sem bagunçar seu projeto |
| Memória / contexto | Caderno local com as decisões e o histórico do projeto |
| MCP | Ferramenta extra que o agente pode chamar (sempre com seu consentimento) |
| Proof | Laudo final que junta testes, verificações e estado do projeto |

---

## 👩‍💻 Se você já é dev

A trilha completa em 6 comandos:

```bash
gstack_vibehard start                                  # objetivo → consult read-only → plano → execução confirmada
gstack_vibehard create meu-app && cd meu-app           # scaffold lite (project-scoped)
gstack_vibehard dev                                    # runtime supervisionado: logs + readiness + stop/open
gstack_vibehard context scout "como o auth funciona?" --json   # contexto local-first (índice offline)
gstack_vibehard verify --json                          # gates determinísticos por arquétipo
gstack_vibehard proof --json                           # veredito único: verify + audit + readiness + git
```

### Lite ou Full?

**Lite** (default do `create`): só arquivos do projeto — nada global, nenhuma
config de IA tocada, nenhuma dependência pesada. **Full** (`install`): a
plataforma completa — com preflight obrigatório, backup + manifest, confirmação
explícita e rollback real via `uninstall`. Não empilhe caminhos: o `consult`
recomenda um e detecta empilhamento. Detalhes: [caminhos de instalação](docs/guides/install-paths.md).

### Como saber se está pronto · como desfazer

`proof --json` responde com `ready:true` **somente** quando todos os gates
determinísticos passam (nenhuma opinião de modelo decide). Para desfazer:
`uninstall --dry-run` mostra o plano; `uninstall` restaura via manifest e
preserva o que você editou — [guia de reset](docs/guides/reset-uninstall.md).

---

## 🔧 Para engenheiros: o que existe por trás

Capacidades reais (cada uma com guia próprio — o README não tenta explicar tudo):

- ⛔ Bloqueio de comando destrutivo com hooks reais + Challenge-Response para ações de alto risco
- 🧠 Memória entre sessões (chronicle) e contexto indexado offline, local-first
- 🛡️ Scanner de segredos no diff; delegação bloqueia `.env` rastreado
- 🌳 Worktree lifecycle determinístico (`list/diff/accept/discard/cleanup --dry-run`)
- 🤖 Orquestração: executor em worktree + verifier independente + reviewer LLM **advisory** — LLM nunca aprova sozinho
- 💭 `dream improve` (proposta isolada, nunca auto-merge) e `dream audit` (promessa vs evidência, comportamental) — o placar é do commit atual, não um número fixo: rode `dream audit --json`. Só `RISK`/`PLACEBO` bloqueiam o proof; `NOT_PROVED` é claim sem contrato comportamental ainda, e aparece no placar honestamente
- 🔏 Edit guard hash-anchored: patch só se o trecho lido ainda bate com o hash
- 🧩 MCP project-scoped runtime-injected — nunca `~/.mcp.json` nem config global sem opt-in
- 🕶️ Redaction pré-render opt-in (`proxy`) — **não** é Zero-Trust universal
- 🌐 Agent Reach opt-in com consentimento por canal
- 🎨 Detector nativo de design (WCAG color-contrast, motor Impeccable vendorizado com proveniência) — `visual doctor/detect/explain/hooks`
- 📓 Skills governadas de Obsidian (4 de 5 vendorizadas com hash real) roteadas por intent — vault nunca escapa, `.env*` nunca entra
- 🎬 Router de media-intake (transcript-first, frame bounded) + Scroll World (orçamento de mídia nunca bypassável por `--yes`)

**Honestidade de enforcement:** a maturidade real de cada capacidade está em
[capacidades](docs/guides/capabilities.md) (fonte viva: `tools readiness --json`);
a matriz hooks-reais × instrucional por harness está no
[guia de harnesses](docs/guides/harness-matrix.md) (`agents doctor --json`).
O **Headroom não economiza tokens automaticamente** — enquanto não estiver
`routed`, o estado real é `callable_not_routed`. O gstack **não elimina
alucinação** — ele adiciona gates determinísticos para que um erro do agente
não vire estrago.

## 📚 Documentação

| | |
|---|---|
| [Quickstart](docs/guides/quickstart.md) | 5 minutos, termos explicados |
| [Trilha AI-Driven Dev](.docs/TRAILS/ai-driven-dev/01-nova-stack-do-dev.md) | 5 aulas com comandos reais — nada é instalado |
| [Capacidades: real/callable/opt-in/roadmap](docs/guides/capabilities.md) | o que o produto entrega hoje, sem inflar |
| [Caminhos de instalação](docs/guides/install-paths.md) | lite vs full, matriz de inclusão/exclusão |
| [Reset & uninstall](docs/guides/reset-uninstall.md) | desfazer de verdade |
| [Matriz de harnesses](docs/guides/harness-matrix.md) | enforcement real vs instrucional |
| [Política MCP](docs/MCP-CONNECTOR-POLICY.md) | quando um MCP vira default |
| [Detector de design](docs/guides/design-detector.md) + [hooks por harness](docs/guides/design-hooks.md) | motor Impeccable vendorizado, escopo real (1 regra) |
| [Skills governadas de Obsidian](docs/guides/obsidian-skills.md) | 4 de 5 vendorizadas, vault nunca escapa |
| [Media-intake](docs/guides/media-intake.md) + [Scroll World](docs/guides/scroll-world.md) | transcript-first, orçamento nunca bypassável |
| [Graphify query-first](docs/guides/graphify-query-first.md) + [minimality gate](docs/guides/minimality-gate.md) | subcomandos reais, gates declarados honestamente |
| [Guia completo PT-BR](docs/pt-BR/README.md) · [English](docs/en/README.md) | referência detalhada |
| [SECURITY](SECURITY.md) · [THREAT_MODEL](THREAT_MODEL.md) · [CONTRIBUTING](CONTRIBUTING.md) | governança |

## 📦 Verificação & qualidade

**Para o usuário:** `gstack_vibehard proof --json` — o veredito único
(`gstack.proof.v1`): verify + dream audit + readiness + graphify freshness +
git tree; `ready:true` só com todos os gates determinísticos verdes.

**Para o desenvolvedor do repo:** `npm run proof` — a prova de máquina limpa
(15 etapas, placar PASS/FAIL). Individuais: `npm test` (720+ testes) ·
`npm run test:py` · `npm run lint` · `npm run typecheck:ts` ·
`node src/index.js verify --profile release --json` · Fallow com gate por
regressão (baselines commitadas) · CI em **Linux + Windows + macOS**.

Histórico em **[CHANGELOG.md](CHANGELOG.md)**. Licença **MIT**.

**Pronto para dar um capacete ao seu agente?** 👉 `npx @gstack-vibehard/installer start`
