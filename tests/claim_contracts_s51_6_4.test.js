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

// Os 4 que ficaram genuinamente sem contrato (precisam de controle negativo
// NOVO, ainda não escrito -- S51.6.5/6/7/8): output-guard, governance,
// dream-freshness, type-coverage.
const STILL_NOT_PROVED_IDS = ["output-guard", "governance", "dream-freshness", "type-coverage"]

test("os 16 claims do S51.6.4 graduam REAL no auditor comportamental REAL (não mock)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const claims = audit({ behavioral: true }).claims
  const byId = Object.fromEntries(claims.map((c) => [c.id, c]))
  for (const id of PROMOTED_IDS) {
    assert.ok(byId[id], `claim '${id}' existe`)
    assert.equal(byId[id].status, "REAL", `'${id}' tem contrato comportamental real + arquivos ⇒ REAL`)
  }
})

test("CONTROLE: os 4 sem contrato novo ainda continuam NOT_PROVED honestamente (nada promovido por engano)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const claims = audit({ behavioral: true }).claims
  const byId = Object.fromEntries(claims.map((c) => [c.id, c]))
  for (const id of STILL_NOT_PROVED_IDS) {
    assert.equal(byId[id].status, "NOT_PROVED", `'${id}' ainda não tem contrato -> NOT_PROVED (S51.6.5-8 resolvem)`)
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

test("placar real do commit: 20 REAL / 4 NOT_PROVED após o S51.6.4 (nunca RISK/PLACEBO novo)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const s = audit({ behavioral: true }).summary
  assert.equal(s.RISK || 0, 0)
  assert.equal(s.PLACEBO || 0, 0)
  assert.ok((s.REAL || 0) >= 20, `esperado >=20 REAL, veio ${s.REAL}`)
  assert.equal(s.NOT_PROVED || 0, 4, `esperado exatamente 4 NOT_PROVED restantes, veio ${s.NOT_PROVED}`)
})
