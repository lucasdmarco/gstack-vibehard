import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.6.4 — 16 claims ganharam contrato comportamental (cobertura de
 * controle negativo REAL já existente, investigada a fundo por 2 agentes
 * Explore que leram o conteúdo de cada teste, não só o nome do arquivo).
 * Este teste prova que o auditor REAL (não fixture) reflete a promoção.
 */

const PROMOTED_IDS = [
  "auto-dream", "rollback", "opencode-safe", "task-loop", "runtime-supervisor",
  "secrets-broker", "runtime-manifest", "package-manager", "full-contract",
  "agent-factory", "agentshield", "adapter-matrix", "qa-multi-lens",
  "vfa-provenance", "challenge-response", "meta-harness",
]

test("os 16 claims do S51.6.4 graduam REAL no auditor comportamental REAL (não mock)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const claims = audit({ behavioral: true }).claims
  const byId = Object.fromEntries(claims.map((c) => [c.id, c]))
  const { TEETH_BASELINE } = await imp("src/dream/teeth-baseline.js")
  for (const id of PROMOTED_IDS) {
    assert.ok(byId[id], `claim '${id}' existe`)
    // PRD52 S52.B: a régua passou a verificar o contrato contra o repo. Quem cai,
    // cai registrado no baseline com motivo — o que não pode acontecer é cair calado.
    const esperado = id in TEETH_BASELINE.quedas ? "NOT_PROVED" : "REAL"
    assert.equal(byId[id].status, esperado, `'${id}': status tem de bater com o baseline registrado`)
  }
})

// Invariante ROBUSTA a sub-sprints futuros (S51.6.5+ reduz NOT_PROVED aos
// poucos): qualquer claim SEM contrato registrado em CLAIM_CONTRACTS nunca
// pode estar REAL — a mesma checagem que gradeClaimStatus faz, verificada
// de fora, contra o registro real (não uma lista fixa que apodrece).
test("CONTROLE: claim sem contrato NUNCA aparece REAL no auditor comportamental (nada promovido por engano)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const { CLAIM_CONTRACTS } = await imp("src/dream/claim-contract.js")
  const claims = audit({ behavioral: true }).claims
  for (const c of claims) {
    if (CLAIM_CONTRACTS[c.id]) continue
    assert.notEqual(c.status, "REAL", `'${c.id}' sem contrato não pode estar REAL (senão gradeClaimStatus quebrou)`)
  }
})

test("todo contrato novo tem os 4 campos obrigatórios (nunca fica incompleto por omissão)", async () => {
  const { CLAIM_CONTRACTS, CLAIM_CONTRACT_FIELDS } = await imp("src/dream/claim-contract.js")
  for (const id of PROMOTED_IDS) {
    const c = CLAIM_CONTRACTS[id]
    assert.ok(c, `contrato '${id}' existe`)
    for (const f of CLAIM_CONTRACT_FIELDS) assert.ok(c[f], `contrato '${id}' tem campo '${f}'`)
  }
})

// Piso, não teto exato: sub-sprints seguintes (S51.6.5+) continuam reduzindo
// NOT_PROVED -- um número fixo aqui ficaria stale a cada novo contrato.
test("placar real do commit: pelo menos 20 REAL após o S51.6.4 (nunca RISK/PLACEBO novo)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const s = audit({ behavioral: true }).summary
  assert.equal(s.RISK || 0, 0)
  assert.equal(s.PLACEBO || 0, 0)
  assert.ok((s.REAL || 0) >= 20, `esperado >=20 REAL, veio ${s.REAL}`)
})

// PRD51 S51.6.5 — output-guard ganhou controle negativo novo (caminho
// pós-hoc/RBAC, tests/test_stop_output_guard_rbac.py) e graduou REAL.
test("S51.6.5: output-guard graduou REAL (controle negativo novo do caminho pós-hoc)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const claims = audit({ behavioral: true }).claims
  const og = claims.find((c) => c.id === "output-guard")
  assert.equal(og.status, "REAL", "output-guard agora tem contrato + controle negativo real")
})

// PRD51 S51.6.6 — governance ganhou controle negativo novo (npm sbom real,
// tests/governance_sbom_real.test.js) e graduou REAL.
test("S51.6.6: governance graduou REAL (npm sbom real provado passando E falhando)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const claims = audit({ behavioral: true }).claims
  const gov = claims.find((c) => c.id === "governance")
  assert.equal(gov.status, "REAL", "governance agora tem contrato + controle negativo real")
})

// PRD51 S51.6.7 — dream-freshness ganhou CLI E2E real (dream revoke/stale)
// e graduou REAL.
test("S51.6.7: dream-freshness graduou REAL (dream revoke/stale via CLI real)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const claims = audit({ behavioral: true }).claims
  const df = claims.find((c) => c.id === "dream-freshness")
  assert.equal(df.status, "REAL", "dream-freshness agora tem contrato + controle negativo real")
})

// PRD51 S51.6.8 — type-coverage (o último dos 20) ganhou controle negativo
// real (c8 provado falhando E passando) e graduou REAL. Fecha a ação #3.
test("S51.6.8 (fecha ação #3): type-coverage graduou REAL — as 20 claims NOT_PROVED originais chegam a ZERO", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const r = audit({ behavioral: true })
  const tc = r.claims.find((c) => c.id === "type-coverage")
  assert.equal(tc.status, "REAL", "type-coverage agora tem contrato + controle negativo real")
  // As 20 NOT_PROVED do início do Sprint 51.6 chegaram a ZERO em S51.6.8. O S52.B
  // endureceu a régua e reabriu exatamente as quedas registradas no baseline — o
  // número honesto é esse, e é derivado, nunca digitado.
  const { TEETH_BASELINE } = await imp("src/dream/teeth-baseline.js")
  assert.equal(r.summary.NOT_PROVED || 0, Object.keys(TEETH_BASELINE.quedas).length,
    "NOT_PROVED só pode conter as quedas registradas com motivo no baseline do S52.B")
})
