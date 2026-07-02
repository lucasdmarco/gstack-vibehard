# Matriz de harnesses — o que é enforcement REAL vs orientação

O gstack nunca rotula harness instrucional como Zero-Trust. A fonte de verdade é
`gstack_vibehard agents doctor --json` (matriz viva); esta página explica os níveis.

| Nível | Harnesses | O que existe de verdade |
|---|---|---|
| **Hooks reais** (bloqueio automático) | Claude Code, Cursor | PreToolUse/Stop/SessionStart no `settings.json`/`hooks.json` — gates bloqueiam ANTES da ação (inclui Challenge-Response/VFA) |
| **Hooks reais** (plugins) | OpenCode | Plugins JS manifest-owned (`tool.execute.before`) + kill switch `GSTACK_OPENCODE_DISABLE=1` |
| **Instrucional** (best-effort) | Codex, Gemini, Windsurf, Kiro, Copilot CLI, Droid, Kilo, Kimi | Arquivo de orientação (`AGENTS.md`/convention do harness) — o agente é ORIENTADO a rodar os gates; **sem bloqueio por API** |
| **Detecção** | Zed, VS Code | Reconhecidos pelo `doctor`; integração instrucional por-repo |

## O que isso significa na prática

- **Challenge-Response (VFA)**: enforcement pre-tool só onde há hooks reais; nos demais é `posthoc_audit_only` (auditoria depois, declarada).
- **Output Guard**: padrão é auditoria pós-resposta em TODOS; redação em trânsito exige `gstack_vibehard proxy` (opt-in) e só funciona onde o harness aceita base-URL custom (`proxy status` mostra a matriz).
- **Delegação/orquestração**: workers rodam em worktrees isoladas com gates determinísticos no retorno — isso vale para QUALQUER harness, porque o gate roda no gstack, não no harness.

## Caminhos de enforcement quando o harness não tem hook

1. `gstack_vibehard verify` / `workflow run` — o gate roda como comando, não como hook.
2. `gstack_vibehard proxy` — interceptação em trânsito via base-URL (onde suportado).
3. `orchestrate` — executor + verifier independente + QG bloqueante, worktree-isolado.
