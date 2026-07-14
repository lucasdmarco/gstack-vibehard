# Clean-Machine Runbook — gstack_vibehard

> Passo a passo para rodar o **Clean-Machine Test Pack** numa máquina **limpa** (Windows,
> macOS ou Linux) SEM setup prévio do mantenedor, e me reportar o JSON. Fecha o PRD42 (S42.13):
> a prova de que o produto funciona de verdade para o usuário final.

## O que este pack prova

Simula a jornada real de um usuário que acabou de instalar o pacote e consolida tudo num
relatório único **`gstack.cleanmachine.v1`** com status **por capacidade** e **por plataforma**.
Invariantes de honestidade (fail-closed):

- **Só `passed` é verde.** `not_applicable`, `blocked_missing_engine` e `not_run` NUNCA contam
  como aprovado nem inflam o placar.
- Capacidade **não suportada** na sua plataforma ⇒ `not_applicable` (documentado, nunca "passa
  por omissão").
- **Backends** (Casdoor RBAC, Atomic merge, AgentMemory, OpenHands sandbox) sem engine local
  (Docker) ⇒ `blocked_missing_engine` ⇒ veredito **`ready_engines_blocked`** — parcial honesto,
  **nunca "ready" liso**. Rodar os backends de verdade exige Docker (ver §4).
- Qualquer jornada que **falha** ⇒ `not_ready`. Qualquer jornada **não rodada** ⇒ `incomplete`.

## 1. Pré-requisitos (só isto)

- **Node.js ≥ 18** (`node --version`).
- **Python 3** no PATH (para o QG/Fallow — `python --version` no Windows, `python3` no Unix).
- Git (para clonar).
- **Não** precisa de Docker para o pack passar — sem Docker os backends viram
  `blocked_missing_engine` (honesto). Docker só é necessário para o §4 (E2E de backend real).

## 2. Rodar o pack

```bash
git clone <repo-url> gstack_vibehard
cd gstack_vibehard
npm ci
npm run test:cleanmachine
```

O pack roda, nesta ordem, compondo os provadores existentes (não reimplementa):

1. **package-lifecycle** — `npm pack` → instala o `.tgz` num prefixo isolado → `create`/`build`/
   `uninstall` byte-a-byte (via `test:e2e:package`). *(pule com `GSTACK_CM_SKIP_PACKAGE=1` para
   um smoke rápido do agregador.)*
2. **offline-invariants** — `tools clean-machine --json`: OpenCode config-sacred, Lite sem escrita
   global, restore byte-a-byte, matriz de tools (12 cenários em homes-fixture isoladas).
3. **proof-full** — `proof --profile full --explain --json`: o carimbo determinístico
   (verify/dream/graphify/git/skill-gates) em visão leiga + técnica.
4. **dream-behavioral** — `dream audit --json`: 0 RISK / 0 PLACEBO.

Ao final imprime o **VEREDITO** e grava `.gstack/reports/cleanmachine.json`.

## 3. Me reportar

Cole no chat:

- A saída do terminal (o placar de CAPACIDADES + a linha VEREDITO), **e**
- O conteúdo de `.gstack/reports/cleanmachine.json`.

Como no PRD26, o seu transcript vira o insumo: eu comparo o `verdict`/`platform`/`summary` contra
o esperado da sua plataforma e ajusto o que estiver desalinhado. **Exit 0** = `ready` ou
`ready_engines_blocked` (sem Docker); **exit 1** = `not_ready`/`incomplete` (falha real).

## 4. (Opcional) E2E de backend real — precisa de Docker

Os backends só são provados de verdade com o daemon do Docker ativo. Na CI isso roda no workflow
`capability-e2e.yml` (1 job por backend, imagem fixada por digest). Localmente:

```bash
# com Docker Desktop / daemon ativo:
npm run test:e2e:capabilities
```

Sem Docker o pack os reporta como `blocked_missing_engine` — que é o estado honesto, **não** uma
falha do produto.

## 5. Matriz de plataforma esperada

| Capacidade | Windows | macOS | Linux |
|---|---|---|---|
| lite-no-global-leak | passed | passed | passed |
| opencode-config-sacred | passed | passed | passed |
| casdoor/atomic/agentmemory | passed com Docker · senão `blocked_missing_engine` | idem | idem |
| openhands-sandbox | `not_applicable` (unsupported) | `wsl_only` | passed com Docker |

Um `not_applicable` na sua plataforma é **esperado e correto** — não é falha.
