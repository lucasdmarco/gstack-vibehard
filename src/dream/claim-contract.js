/**
 * Contrato de evidência de claim (PRD41 S41.9 / PRD40 P1.6).
 *
 * A honestidade do Dream Audit sobe de nível: a PRESENÇA DE ARQUIVO deixa de valer como
 * REAL. Um claim só é `REAL` se declara um CONTRATO COMPORTAMENTAL — um adaptador de
 * evidência, um comando E2E que exercita o comportamento, um CONTROLE NEGATIVO (o teste
 * que reprova se a capacidade for removida) e uma janela de FRESCOR. Sem isso, o melhor
 * que um claim "com arquivos no lugar" alcança é `NOT_PROVED` — nem RISK/PLACEBO (não é
 * mentira ativa), nem REAL (não há prova de que FUNCIONA para o usuário final).
 */
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
 * comportamental; REAL sem contrato → `NOT_PROVED`. RISK/PLACEBO/PARTIAL/ROADMAP passam
 * intactos (não são elevados por arquivo — só o comportamento eleva a REAL).
 */
export function gradeClaimStatus(fileStatus, contract) {
  if (fileStatus !== "REAL") return fileStatus
  return hasBehavioralContract(contract) ? "REAL" : NOT_PROVED
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
  "action-kernel": {
    evidenceAdapter: "src/skills/action-kernel.js", e2eCommand: "runGovernedAction (task/workflow/delegate)",
    negativeControl: "tests/action_kernel_governed.test.js — ação negada NÃO executa", freshness: "por-ação",
  },
  "loop-checkpoint": {
    evidenceAdapter: "src/skills/loop-checkpoint.js", e2eCommand: "node src/index.js loop checkpoint/rollback --run <id>",
    negativeControl: "tests/checkpoint_security.test.js — tamper/traversal/.env abortam", freshness: "por-checkpoint",
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
