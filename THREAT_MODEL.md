# Threat Model — gstack_vibehard

Modelo de ameaças do **gstack_vibehard**: instalador e control-plane cross-harness para agentes de código (Claude Code, Codex, Cursor, OpenCode…). Foco em ameaças REAIS da superfície do produto e nas mitigações DETERMINÍSTICAS já implementadas. Não é boilerplate.

## Ativos
- Segredos do usuário (tokens, `DATABASE_URL`) e o keychain do SO.
- Configs globais dos harnesses (`~/.claude`, `~/.codex`, `~/.config/opencode`…) e hooks.
- Código do projeto (worktrees de execução delegada) e o histórico git.
- A cadeia de proveniência (`.gstack/provenance/`).

## Atores / confiança
- **Usuário** (confiável) roda a CLI.
- **Agente LLM** (semi-confiável) propõe/executa ações — pode ser manipulado por prompt injection.
- **Conteúdo externo** (não-confiável): pacotes de knowledge, planos, manifests, `.md` de agentes, deps.

## Ameaças e mitigações

| # | Ameaça | Vetor | Mitigação (determinística) |
|---|--------|-------|----------------------------|
| T1 | **Prompt injection** num agente compilado | `.md` de knowledge/agent com "ignore all previous instructions", exfiltração | **AgentShield** (`src/agents/scanner.js`) bloqueia CRÍTICO no build **e** no `--check` (gate de CI); cobertura honesta (sem ECC = reduced, nunca pass pleno) |
| T2 | **Exfiltração de segredo** | env vazado no state, `.env` exposto, segredo no log/journal | **Secrets Broker** (keychain, sem `.env`); env por **allowlist** (só `secretRefs` declarados); state por whitelist de campos; **redação** antes de persistir; `.env` rastreado bloqueia delegação |
| T3 | **Manifest/plano adulterado** executa código arbitrário | `runtime.json`/`task.json` editado para rodar comando malicioso | Spawn **sem shell** (argv do manifest); validação de schema (command sempre array); **nome de serviço validado** (anti path-traversal); executor por **allowlist** de binário |
| T4 | **Adulteração de config global** de harness por agente | agente escreve em `~/.config/opencode` sem rastro | **Challenge-Response** exige `install-manifest-owner`/`backup-path`/`rollback-plan` antes da escrita (hook real); **safe-write** + manifest com rollback; instrucional = `posthoc_audit_only` |
| T5 | **Ação não-provável** ("o agente disse que fez") | sem trilha do que foi tentado/alterado | **VFA Provenance** — recibos com **hash-chain** (`audit verify` falha se adulterado); separa `llm_review_advisory` de `deterministic_gate` |
| T6 | **Harness fingindo enforcement** | "Zero-Trust" num harness só-instrucional | **Capability/Adapter Matrix honesta** — `real_hooks`/`partial`/`rules_only`/`instructional`/`detection_only`; nenhum instrucional rotulado enforcement |
| T7 | **Loop autônomo descontrolado** | agente em loop gasta recursos / faz dano repetido | **Circuit breaker** (maxConsecutiveSameFailure → handoff humano), hard caps (iterations/wall-clock), **sem auto-merge** |
| T8 | **Revisão otimista** (duas LLMs concordam) | reviewer LLM aprova mudança ruim | **Dupla verificação**: gate determinístico DECIDE; LLM aprova + QG falha = `failed`, nunca `passed`; verifier ≠ executor em risco alto |
| T9 | **Supply chain** | dep maliciosa, binário não-verificado | Deps mínimas; downloads remotos **opt-in** (`--allow-remote-downloads`); fonte verificada antes de instalar; **SBOM** + **CodeQL** no CI |
| T10 | **Drift de prompt gerado** | adapter editado à mão diverge da fonte | **Drift Guard** (`build:agents --check`) falha se generated stale/editado/sem o Execution Contract; manifest v2 com hashes |

## Fora de escopo
- Comprometimento do SO/keychain do host (assume-se a conta do usuário íntegra).
- Interceptação do render do harness (nenhuma CLI consegue — o Output Guard é auditoria pós-resposta, declarado honestamente como `RISK` no `dream audit`).
- Multi-harness escrevendo no mesmo workspace sem lock (não habilitado por default).

## Princípio-guia
> A pergunta não é "o agente prometeu obedecer?", e sim "o sistema consegue PROVAR o que foi tentado, o que mudou, qual policy decidiu e por quê — e BLOQUEAR de forma determinística?".
