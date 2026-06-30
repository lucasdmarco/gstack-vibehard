# Security Policy — gstack_vibehard

## Reportar uma vulnerabilidade

Não abra issue pública para falhas de segurança. Reporte de forma privada:

- **GitHub Security Advisory:** use *Security → Report a vulnerability* no repositório.
- Inclua: versão (`gstack_vibehard --version`), passos de reprodução, impacto e, se possível, um PoC mínimo.

Resposta-alvo: triagem em até 5 dias úteis. Correções de severidade **crítica/alta** entram num patch fora de ciclo, com crédito ao reporter (opt-in).

## Versões suportadas

Apenas a **última minor** publicada no npm (`@gstack-vibehard/installer`) recebe correções de segurança. Atualize com `npm i -g @gstack-vibehard/installer@latest`.

## Postura de segurança (defesas embutidas)

O gstack é um instalador/control-plane cross-harness — segurança é fundação, não fase. Defesas determinísticas (não dependem de prompt):

| Superfície | Defesa |
|---|---|
| Segredos | **Secrets Broker** no keychain do SO (DPAPI/Keychain/libsecret) — sem `.env` em claro; env por allowlist; redação antes de persistir; `.env` rastreado bloqueia delegação |
| Prompt injection nos agentes | **AgentShield** — scan determinístico bloqueia no build **e** no `--check` (gate de CI) |
| Execução de runtime | Spawn **sem shell** (argv), validação de nome (anti path-traversal), kill da árvore de processos, state por whitelist (sem env/segredo em disco) |
| Escrita global / config de harness | **Challenge-Response** exige backup/manifest/rollback antes da ação (hook real); `safe-write` + manifest com rollback |
| Provabilidade das ações | **VFA Provenance** — recibos com hash-chain (`audit verify` detecta adulteração) |
| Revisão de mudanças | **diff-hygiene** + **QA Multi-Lens** (eval/secret/exec/query) determinísticos |
| Confiança por harness | **Capability/Adapter Matrix honesta** — harness instrucional é `posthoc_audit_only`, nunca rotulado "Zero-Trust" |
| Supply chain | Deps mínimas; downloads remotos **opt-in**; fontes verificadas antes de instalar; **SBOM** (`npm run sbom`) + **CodeQL** no CI |

Detalhe do modelo de ameaças: [`THREAT_MODEL.md`](THREAT_MODEL.md).

## Princípios

- **Determinístico decide.** Revisão por LLM é advisory; gates locais (Fallow/QG, testes, diff-hygiene) decidem "pronto".
- **Honestidade.** Se um gate está indisponível, o status é *blocked*, não *passed*. Nenhum claim de enforcement onde só há instrução.
- **Sem efeito colateral oculto.** Escrita global é registrada no manifest e reversível.
