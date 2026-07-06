# Capacidades do gstack — o que é real, callable, opt-in ou roadmap

Esta página existe para **não vender mais do que o produto entrega hoje**. A fonte
de verdade viva é `gstack_vibehard agents doctor --json` (matriz de harnesses) e
`gstack_vibehard tools readiness --json` (estado real das ferramentas). Aqui os
níveis estão explicados em texto.

## Legenda dos níveis

| Nível | Significa |
|---|---|
| **Real agora** | Roda e **bloqueia/age automaticamente** sem flag extra, com teste verde. |
| **Callable / manual** | Existe e funciona **sob demanda** (você roda o comando); não há roteamento automático de tráfego do harness por ele. |
| **Opt-in** | Só acontece com **consentimento explícito** (flag/confirmação); nunca por default. |
| **Roadmap** | Planejado, **ainda não pronto**. Não conte com isso. |

## Real agora

- **Bloqueio de comando destrutivo** via hooks (PreToolUse/Stop) onde o harness tem hooks reais.
- **Challenge-Response (VFA)** pre-tool onde há hooks reais; auditoria pós-hoc declarada nos demais.
- **Scanner de segredos no diff**; delegação **bloqueia** `.env` rastreado.
- **Runtime por projeto**: `dev` / `stop` / `logs` / `open` com manifest.
- **Worktree lifecycle**: `list` / `diff` / `accept` / `discard` / `cleanup --dry-run` (estados determinísticos).
- **Contexto indexado offline** (SQLite/FTS): `context index` / `status --db` / `scout` — inclui `scout --mode decision_context`.
- **Orquestração v2**: executor em worktree + verifier independente + reviewer LLM **advisory** — o LLM **nunca** aprova sozinho.
- **Safe install + rollback**: tudo que o `install` escreve tem **backup + manifest**; `uninstall` restaura o que você tinha, byte-for-byte quando aplicável.
- **Release gate observável**: `verify --profile release --json` com progresso por etapa, timeout por etapa e status distintos (`--dry-run` lista sem executar).
- **Prova de máquina limpa**: `tools clean-machine --json` roda 12 cenários offline (OpenCode config-sacred byte-for-byte, Lite sem escrita global, Full com Safe Write, uninstall restaura, matriz de ferramentas). O JSON declara `mode: "simulated_offline"` — o estado REAL da máquina é o `tools readiness`.
- **Veredito único de release**: `proof [--profile release] --json` (`gstack.proof.v1`) — agrega verify + dream audit + readiness + graphify freshness + headroom claim + git tree; `ready:true` só com TODOS os gates determinísticos verdes (exit 0/1).

## Callable / manual (roda sob demanda; **não** roteia tráfego sozinho)

- **Fallow** — quality gate determinístico (`npx fallow`); é chamado pelos comandos de verificação, não intercepta o harness.
- **Graphify** — topologia de código; `tools readiness` declara se o grafo está `fresh`/`stale`/`absent` vs `git HEAD` **e, quando não-fresh, traz `recommendedAction`** (`tools refresh --changed` para stale; `graphify index .` para absent). Grafo `stale` é warning visível — cheque freshness antes de claims baseados em topologia.
- **gstack context** — busca de docs offline (precisa do índice construído).
- **Printing Press / MCP inventory** — catálogo e inventário read-only por harness.

## Opt-in (só com consentimento explícito)

- **Agent Reach** — canais de leitura na internet, consentimento por canal.
- **MCP global** — `install` registra MCP global com opt-out `--no-global-mcp`.
- **proxy** — redação de segredos **pré-render** (em trânsito), via `gstack_vibehard proxy` + base-URL custom (`ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`/provider.baseURL). Rota REAL só em Claude/Codex/OpenCode; Cursor e harnesses instrucionais têm apenas auditoria **pós-resposta** (Stop hook). **Não é Zero-Trust universal** — é uma defesa opt-in a mais.
- **Cloud handoff (Devin)** — nunca default.
- **tools install `<tool>`** — baixa/instala de fonte remota, exige `--yes` em modo não-interativo.

## Roadmap (ainda não pronto)

- **`tools generate`** — CLI de cauda-longa via HAR (em breve).
- **Roteamento automático de Headroom** — hoje é `callable_not_routed` (ver abaixo).
- **Adapters externos novos** (Ruflo/ECC/Codebuff/Freebuff) — são **candidatos**; por política (PRD20) **não** são instalados por default antes de `verify --profile release` observável e verde.

---

## Headroom **não economiza tokens automaticamente**

O Headroom pode estar instalado e **callable**, mas isso **não** significa que o
seu Claude/Codex/OpenCode passa tráfego por ele. Enquanto o proxy não estiver
rodando **e** o harness roteado, o estado honesto é **`callable_not_routed`** — e
o gstack **nunca** reivindica economia automática nesse estado.

```bash
gstack_vibehard tools readiness --json    # mostra headroom: callable_not_routed | routed
```

Só vira `routed` quando `headroom doctor` confirma **proxy rodando E tráfego
roteado**. Sem isso, trate qualquer número de "economia" como não comprovado.

---

## Por harness (enforcement real vs orientação)

| Harness | Nível | O que existe de verdade |
|---|---|---|
| **Claude Code** | Real (hooks) | PreToolUse/Stop/SessionStart em `settings.json` — bloqueio antes da ação (inclui Challenge-Response). |
| **Cursor** | Real (hooks) | `hooks.json` project-scoped — bloqueio antes da ação. |
| **OpenCode** | Real (plugins) | Plugins JS manifest-owned + kill switch `GSTACK_OPENCODE_DISABLE=1`. Config `.jsonc` **sagrada** — nunca reescrita. |
| **Devin** | Real **condicional** | Hooks project-scoped **quando o Devin está instalado e os carrega**; senão o `doctor` faz downgrade honesto para `rules_only`/`partial`. |
| **Codex** | Instrucional | `AGENTS.md` orienta o agente a rodar os gates; **sem bloqueio por API**. O gate ainda roda como comando (`verify`). |
| **Ruflo / Codebuff / Freebuff** | Candidatos (roadmap) | **Não** instalados por default; avaliados como adapters futuros sob a regra de sequenciamento do PRD20. |

Detalhe completo e níveis intermediários: [matriz de harnesses](harness-matrix.md).

> **Claim honesto (PRD25):** a separação **enforced** (hooks reais) vs
> **advisory/instructional** (best-effort) é deliberada e permanente — harness sem API
> de hooks não pode ser forçado. O GStack **não promete Zero-Trust universal**; os
> gates determinísticos (`verify`, QG, `publish-guard`) continuam valendo como comando
> em qualquer harness. Verifique ao vivo: `agents doctor --json` ·
> `doctor --conformance --strict --json`.

---

## Começo honesto em 3 comandos

```bash
# 1) trilha guiada (objetivo → consult read-only → plano → execução confirmada)
npx @gstack-vibehard/installer start

# 2) entenda o projeto pelo índice offline (JSON puro, sem rede)
node src/index.js context scout "como o projeto funciona?" --json

# 3) rode o gate determinístico só no que mudou
node src/index.js verify --changed-files --json
```

---

## Quando usar gstack — e quando **não**

O gstack vence quando a tese é **"criar e operar um projeto local protegido, com
rollback, gates, contexto e worktrees"**. Ele não tenta ser o mais leve para
"deixar meu Claude um pouco mais esperto agora".

| Você quer… | Escolha honesta |
|---|---|
| Scaffold + runtime + rollback + worktree + QG + policy num projeto vivo | **gstack** |
| Transformar o Codex num ambiente local tipo Replit (`start`/`dev`/`verify`/contexto/gates) | **gstack** (onde tende a ser mais competitivo) |
| Só regras/skills cross-harness, plugin leve, sem criar projeto | ECC ou Ruflo plugin |
| "Nunca mais quero provider/model do OpenCode sumindo" e nada além disso | Prove primeiro o config-sacred do gstack (`tools clean-machine`, `doctor --opencode`); se ainda quiser algo mínimo, ECC/Codebuff são mais simples |

Regra de ouro: **não empilhe** métodos. Rode `npx @gstack-vibehard/installer consult`
para uma recomendação de caminho único (ele detecta empilhamento).
