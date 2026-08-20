/**
 * Contrato de evidência de claim (PRD41 S41.9 / PRD40 P1.6).
 *
 * A honestidade do Dream Audit sobe de nível: a PRESENÇA DE ARQUIVO deixa de valer como
 * REAL. Um claim só é `REAL` se declara um CONTRATO COMPORTAMENTAL — um adaptador de
 * evidência, um comando E2E que exercita o comportamento, um CONTROLE NEGATIVO (o teste
 * que reprova se a capacidade for removida) e uma janela de FRESCOR. Sem isso, o melhor
 * que um claim "com arquivos no lugar" alcança é `NOT_PROVED` — nem RISK/PLACEBO (não é
 * mentira ativa), nem REAL (não há prova de que FUNCIONA para o usuário final).
 *
 * PRD52 S52.B — OS DENTES. Até aqui a exigência era só que os quatro campos fossem
 * *truthy*: prosa bem escrita passava. Agora cada campo é VERIFICADO contra o repo
 * auditado por `claim-contract-check.js` — o adaptador existe, o comando E2E é
 * executável, o controle negativo é um teste real e toca a capacidade. Um contrato
 * que não sobrevive à verificação vale o mesmo que contrato ausente: `NOT_PROVED`.
 */
import { contratoComDentes, problemasDoContrato, ehDistribuicao } from "./claim-contract-check.js"

export const CLAIM_CONTRACT_SCHEMA = "gstack.dream.claim-contract.v1"

export const CLAIM_CONTRACT_FIELDS = Object.freeze([
  "evidenceAdapter", "e2eCommand", "negativeControl", "freshness",
])

// Status novo: arquivos presentes, comportamento NÃO provado por E2E+controle-negativo.
export const NOT_PROVED = "NOT_PROVED"

/** Um contrato é comportamental de verdade? (todos os campos exigidos + scopes). */
export function hasBehavioralContract(contract) {
  if (!contract || typeof contract !== "object") return false
  return CLAIM_CONTRACT_FIELDS.every((f) => Boolean(contract[f]))
}

/**
 * Rebaixa o status de um claim segundo o contrato: `REAL` só sobrevive COM contrato
 * comportamental VERIFICADO; REAL sem contrato → `NOT_PROVED`. RISK/PLACEBO/PARTIAL/
 * ROADMAP passam intactos (não são elevados por arquivo — só o comportamento eleva a
 * REAL).
 *
 * `io` é o leitor do repo auditado (o auditor roda tanto no repo-fonte quanto no
 * tarball). Omiti-lo NÃO desliga a verificação: cai no repo deste módulo. Uma
 * verificação que só acontece quando alguém lembra de injetar o leitor seria um
 * portão com porta dos fundos.
 */
export function gradeClaimStatus(fileStatus, contract, io = undefined) {
  if (fileStatus !== "REAL") return fileStatus
  if (!hasBehavioralContract(contract)) return NOT_PROVED
  // Numa DISTRIBUIÇÃO, os testes não viajam por design. As regras que exigem o
  // arquivo do controle negativo não têm como ser satisfeitas ali, e aplicá-las
  // faria o pacote instalado reportar que NADA está provado — falso, e medido:
  // 24 NOT_PROVED no tarball contra 24 REAL no repo do MESMO commit.
  if (ehDistribuicao(io)) return "REAL"
  return contratoComDentes(contract, io) ? "REAL" : NOT_PROVED
}

/** POR QUE o claim caiu — o motivo por claim que o placar e o closeout registram. */
export function motivosDaQueda(contract, io = undefined) {
  if (!hasBehavioralContract(contract)) return ["[campos] contrato ausente ou incompleto"]
  return problemasDoContrato(contract, io)
}

// Registro dos claims que TÊM prova comportamental de verdade — os construídos com E2E +
// controle negativo nas sprints do PRD41 (cada um aponta o comando E2E e o teste-negativo
// que reprova se a capacidade sumir). O que não está aqui NÃO é REAL só por ter arquivo.
export const CLAIM_CONTRACTS = Object.freeze({
  "verify": {
    evidenceAdapter: "src/project-plan/verify-runner.js", e2eCommand: "node src/index.js verify",
    negativeControl: "tests/verify_gates.test.js — gate falho reprova", freshness: "por-run",
  },
  "qa-lens": {
    evidenceAdapter: "src/skills/visual-gate.js", e2eCommand: "node src/index.js loop observe --run <id> --url <app>",
    negativeControl: "tests/visual_qa_real.test.js — 500/a11y/screenshot ausente falham por motivos distintos", freshness: "por-observação",
  },
  // PRD52 S52.I — o contrato declarava `runGovernedAction (task/workflow/delegate)`
  // como comando E2E: um NOME DE FUNCAO, e de uma funcao que nao tinha UM chamador
  // em codigo de produto. Agora o `delegate` atravessa o kernel de verdade, e o
  // comando abaixo RODA.
  "action-kernel": {
    evidenceAdapter: "src/skills/action-kernel.js",
    e2eCommand: "node src/index.js delegate opencode --task \"<tarefa>\" --yes",
    negativeControl: "tests/e2e/action_kernel.e2e.test.js — pelo binario real, em repo limpo: tarefa destrutiva e NEGADA e o alvo nunca e invocado (`executed:false`, exit 126, motivo no ledger); tarefa equivalente SEM o gatilho atravessa e chega ao alvo (`executed:true`) — sem o segundo caso, o primeiro nao provaria nada; e o payload nunca vai cru para o ledger. Cobertura de modulo segue em tests/action_kernel_governed.test.js",
    freshness: "por-ação",
  },
  "loop-checkpoint": {
    evidenceAdapter: "src/skills/loop-checkpoint.js", e2eCommand: "node src/index.js loop checkpoint/rollback --run <id>",
    negativeControl: "tests/checkpoint_security.test.js — tamper/traversal/.env abortam", freshness: "por-checkpoint",
  },
  // PRD51 S51.6.4 — 16 contratos com cobertura de controle negativo REAL já
  // existente (investigados a fundo, teste lido linha a linha, não citação de
  // fé): cada um teria FALHADO se a capacidade tivesse quebrado/sumido.
  "auto-dream": {
    evidenceAdapter: "src/dream/runner.js", e2eCommand: "node src/index.js dream improve && node src/index.js dream promote <id> --reviewed",
    negativeControl: "tests/dream_improve.test.js + tests/dream_learning.test.js — merge nunca automático, worktree sempre limpo mesmo com erro, promoção sem --reviewed é recusada, proposta sabotada é bloqueada pelo AgentShield",
    freshness: "por-ciclo",
  },
  "rollback": {
    evidenceAdapter: "src/installer/uninstall.js", e2eCommand: "node src/index.js uninstall --restore-only --yes",
    negativeControl: "tests/uninstall_restore.test.js + tests/doctor_integrity.test.js — arquivo editado pós-instalação NUNCA é sobrescrito sem --resolve-drift; backup ausente é detectado (safeToUninstall:false)",
    freshness: "por-instalação",
  },
  "opencode-safe": {
    evidenceAdapter: "src/installer/opencode-jsonc.js", e2eCommand: "node src/index.js doctor --fix opencode --apply",
    negativeControl: "tests/opencode_jsonc_doctor.test.js — .jsonc com chaves OAuth/provider/plugin fica byte-a-byte intacto (sha256 antes/depois) mesmo com --apply",
    freshness: "por-fix",
  },
  "task-loop": {
    evidenceAdapter: "src/project-plan/task-loop.js", e2eCommand: "node src/index.js task run <planId> --yes",
    negativeControl: "tests/task_run.test.js — passo com debugger é rejeitado por diff-hygiene e a branch é apagada; .env rastreado bloqueia o loop inteiro (repo git real)",
    freshness: "por-execução",
  },
  "runtime-supervisor": {
    evidenceAdapter: "src/runtime/supervisor.js", e2eCommand: "node src/index.js dev && node src/index.js stop",
    negativeControl: "tests/runtime_supervisor.test.js — stopAll NUNCA mata um PID reutilizado/estrangeiro (verificação de idade, fail-closed sem startedAt); env não-allowlisted nunca chega ao serviço",
    freshness: "por-sessão",
  },
  "secrets-broker": {
    evidenceAdapter: "src/secrets/broker.js", e2eCommand: "node src/index.js secrets run -- <cmd>",
    negativeControl: "tests/secrets.test.js — o índice em disco NUNCA contém o valor do segredo (só nomes); nomes com path-traversal são rejeitados antes do provider do SO",
    freshness: "por-operação",
  },
  "runtime-manifest": {
    evidenceAdapter: "src/runtime/manifest.js", e2eCommand: "node src/index.js dev --json",
    negativeControl: "tests/runtime_manifest.test.js — CONTROLE NEGATIVO: schemaVersion errado/nome com ../../../PWNED são rejeitados; preview só vira ready com probe de saúde real (nunca 'verde' por chegar)",
    freshness: "por-run",
  },
  "package-manager": {
    evidenceAdapter: "src/installer/package-manager.js", e2eCommand: "node src/index.js doctor --package-manager",
    negativeControl: "tests/package_manager.test.js — dois lockfiles → lockfile_conflict; binário pnpm ausente do PATH → missing_binary com reparo concreto",
    freshness: "por-diagnóstico",
  },
  "full-contract": {
    evidenceAdapter: "src/installer/full-contract.js", e2eCommand: "node src/index.js install",
    negativeControl: "tests/full_contract.test.js — componente obrigatório degradado sem --allow-degraded bloqueia; componente opcional degradado ao lado de um obrigatório degradado AINDA bloqueia (opcional não dilui o gate real)",
    freshness: "por-instalação",
  },
  "agent-factory": {
    evidenceAdapter: "src/agents/factory.js", e2eCommand: "node scripts/scripts/build_agents.js --check",
    negativeControl: "tests/build_agents.test.js — adapter gerado editado à mão faz --check sair 1 (drift guard); diferença de CRLF não gera falso-positivo",
    freshness: "por-build",
  },
  "agentshield": {
    evidenceAdapter: "src/agents/scanner.js", e2eCommand: "node scripts/scripts/build_agents.js",
    negativeControl: "tests/build_agents.test.js — frase real de prompt-injection em knowledge/evil.md faz o build E o --check saírem 1 (CRITICO bloqueia)",
    freshness: "por-build",
  },
  "adapter-matrix": {
    evidenceAdapter: "src/agents/adapter-matrix.js", e2eCommand: "node src/index.js agents doctor --json",
    negativeControl: "tests/agents_adapter_matrix.test.js — harness instrucional que reivindica enforcement real_hooks é rejeitado (\"não pode reivindicar\") pelo validateScorecard",
    freshness: "por-diagnóstico",
  },
  "qa-multi-lens": {
    evidenceAdapter: "src/project-plan/qa-lenses.js", e2eCommand: "node src/index.js qa --json",
    negativeControl: "tests/qa_lenses.test.js — cada lente (eval/any/bare-except/unbounded-query/shell-exec/shell-true/new-function) dispara em código real E não produz falso-positivo em código limpo",
    freshness: "por-run",
  },
  "vfa-provenance": {
    evidenceAdapter: "src/vfa/attestation.js", e2eCommand: "node src/index.js audit verify [runId]",
    negativeControl: "tests/vfa_attestation.test.js — cadeia adulterada/recibo removido quebra verifyChain; actions.jsonl adulterado NO DISCO faz verifyRun retornar valid:false",
    freshness: "por-run",
  },
  "challenge-response": {
    evidenceAdapter: "src/vfa/challenge.js", e2eCommand: "node src/index.js challenge evaluate --intent edit_file --target <path> --scope global --harness <id> --evidence <k1,k2>",
    negativeControl: "tests/vfa_challenge.test.js — challengeCommand via CLI: ação de alto risco sem evidência completa é DENY; harness instrucional vira posthoc_audit_only (nunca bloqueio pré-ação)",
    freshness: "por-ação",
  },
  "meta-harness": {
    evidenceAdapter: "src/meta/orchestrator.js", e2eCommand: "node src/index.js orchestrate <planId> --yes",
    negativeControl: "tests/meta_orchestrator.test.js + tests/orchestrate.test.js — reviewer (LLM) aprovando NUNCA salva um gate QG reprovado (regra de ouro); passo com debugger falha via git real, sem branch órfã",
    freshness: "por-run",
  },
  // PRD51 S51.6.5 — o caminho PRE-RENDER (proxy opt-in) já tinha controle
  // negativo (redact_proxy.test.js/guard_status.test.js); faltava o caminho
  // PÓS-HOC (stop.py, roda em TODO turno, sem opt-in) — nenhum teste chamava
  // output_guard() de verdade. Novo teste (subprocess real do hook) fecha isso.
  "output-guard": {
    evidenceAdapter: "hooks/hooks/_output_guard.py", e2eCommand: "python hooks/hooks/stop.py < payload.json (transcript_path aponta pro transcript real)",
    negativeControl: "tests/test_stop_output_guard_rbac.py — viewer com segredo no transcript é BLOQUEADO (exit 1, decision:block); admin (role_level>=3) tem bypass; transcript limpo nunca bloqueia (sem falso-positivo)",
    freshness: "por-turno",
  },
  // PRD51 S51.6.6 — governance.test.js só checava presença de arquivo/string
  // (duplicava a lógica do próprio auditor). Novo teste roda `npm sbom` de
  // verdade e prova o gate FALHANDO sem manifesto válido, não só passando.
  "governance": {
    evidenceAdapter: "package.json", e2eCommand: "npm sbom --sbom-format cyclonedx --omit dev",
    negativeControl: "tests/governance_sbom_real.test.js — CycloneDX bem-formado com manifesto real; FALHA de verdade (exit != 0, sem JSON válido) sem package.json com version pinada",
    freshness: "por-release",
  },
  // PRD51 S51.6.7 — o próprio codebase se auto-documentava NOT_PROVED aqui
  // ("sem CLI E2E de revoke ainda"). `dream revoke`/`dream stale` (novos
  // comandos) fecham o gap: transição persiste no closeout.json real.
  "dream-freshness": {
    evidenceAdapter: "src/dream/freshness.js", e2eCommand: "node src/index.js dream revoke <candidateId> --reason <texto> | dream stale <candidateId>",
    negativeControl: "tests/dream_freshness_cli.test.js — transição persiste no closeout.json (relido do disco); candidate fora de 'promoted' é recusado (sem salto de estado); candidate inexistente nunca finge sucesso; dream metrics/candidates refletem a mudança ponta a ponta",
    freshness: "por-revogação",
  },
  // PRD51 S51.6.8 — b3_typecheck.test.js só confirmava presença de arquivo/
  // chave de script, nunca que o gate de cobertura REALMENTE falha com
  // cobertura baixa (alguém podia enfraquecer --lines=0 e passaria mesmo
  // assim). Novo teste roda o c8 real (mesmo binário do coverage:ci) contra
  // um fixture com branch não coberta de propósito.
  "type-coverage": {
    evidenceAdapter: "package.json", e2eCommand: "npm run coverage:ci",
    negativeControl: "tests/type_coverage_gate_real.test.js — c8 FALHA de verdade (exit != 0, ERROR reportado) quando o threshold não é atingido; passa quando é; thresholds do script nunca enfraquecidos silenciosamente",
    freshness: "por-build",
  },
})

export function contractFor(claimId) {
  return CLAIM_CONTRACTS[claimId] || null
}

/**
 * PRD45 S45.7 (P1.11): guarda fail-closed contra CONFIG MORTA — toda chave de CLAIM_CONTRACTS
 * DEVE corresponder a um claim real do auditor. Um contrato órfão (id sem claim) nunca é
 * alcançado por `contractFor()`, então declararia prova comportamental que ninguém consome —
 * o bug que deixou qa-lens/action-kernel/loop-checkpoint mortos. Lança em qualquer órfão.
 */
export function assertContractsBindToClaims(claimIds) {
  const known = new Set(claimIds || [])
  const orphans = Object.keys(CLAIM_CONTRACTS).filter((id) => !known.has(id))
  if (orphans.length) {
    throw new Error(`CLAIM_CONTRACTS órfão(s) (contrato sem claim correspondente = config morta): ${orphans.join(", ")}`)
  }
  return true
}
