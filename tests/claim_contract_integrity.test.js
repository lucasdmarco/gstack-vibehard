import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.7 (P1.11) — o registro de contratos comportamentais tinha 3 chaves MORTAS
// (qa-lens/action-kernel/loop-checkpoint) que não correspondiam a nenhum claim: `contractFor()`
// nunca as alcançava, então essas capacidades REAIS e testadas (visual-gate, action-kernel,
// loop-checkpoint — cada uma com teste de controle negativo) não recebiam crédito e o Dream
// Audit só reconhecia `verify` como REAL. Correção: declarar os claims faltantes para os
// contratos VINCULAREM (capacidades genuinamente provadas viram REAL) + guarda fail-closed que
// impede contrato órfão no futuro.

const repoRoot = path.resolve(import.meta.dirname, "..")
const auditorMod = path.join(repoRoot, "src", "dream", "auditor.js")
const contractMod = path.join(repoRoot, "src", "dream", "claim-contract.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

test("guarda: TODA chave de CLAIM_CONTRACTS corresponde a um claim real (sem config morta)", async () => {
  const [{ audit }, { CLAIM_CONTRACTS, assertContractsBindToClaims }] = await Promise.all([imp(auditorMod), imp(contractMod)])
  const claimIds = new Set(audit({ behavioral: true }).claims.map((c) => c.id))
  for (const key of Object.keys(CLAIM_CONTRACTS)) {
    assert.ok(claimIds.has(key), `CONTROLE NEGATIVO: contrato '${key}' não corresponde a nenhum claim (config morta)`)
  }
  // A guarda exportada faz a mesma verificação e lança em config morta.
  assert.doesNotThrow(() => assertContractsBindToClaims([...claimIds]))
  assert.throws(() => assertContractsBindToClaims(["verify"]), /não corresponde|órfão|morto/i)
})

test("os 3 contratos antes mortos agora VINCULAM e graduam REAL (capacidades provadas)", async () => {
  const { audit } = await imp(auditorMod)
  const claims = audit({ behavioral: true }).claims
  const byId = Object.fromEntries(claims.map((c) => [c.id, c]))
  for (const id of ["qa-lens", "action-kernel", "loop-checkpoint"]) {
    assert.ok(byId[id], `claim '${id}' agora existe`)
    assert.equal(byId[id].status, "REAL", `'${id}' tem contrato comportamental + arquivos ⇒ REAL`)
  }
})

test("contratos comportamentais continuam completos (4 campos) — senão o grading rebaixa", async () => {
  const { CLAIM_CONTRACTS, CLAIM_CONTRACT_FIELDS } = await imp(contractMod)
  for (const [id, contract] of Object.entries(CLAIM_CONTRACTS)) {
    for (const field of CLAIM_CONTRACT_FIELDS) {
      assert.ok(contract[field], `contrato '${id}' precisa do campo '${field}' (senão vira NOT_PROVED)`)
    }
  }
})

test("behavioral segue rebaixando REAL SEM contrato para NOT_PROVED (proteção intacta)", async () => {
  const { audit } = await imp(auditorMod)
  const claims = audit({ behavioral: true }).claims
  // qa-multi-lens NÃO tem contrato (é outra capacidade que qa-lens) → continua NOT_PROVED.
  const qaMulti = claims.find((c) => c.id === "qa-multi-lens")
  assert.ok(qaMulti, "qa-multi-lens existe")
  assert.equal(qaMulti.status, "NOT_PROVED", "sem contrato próprio, REAL vira NOT_PROVED (comportamento preservado)")
})

test("proof/publish-guard: nenhum RISK/PLACEBO novo (adicionar claims REAL não desestabiliza)", async () => {
  const { audit } = await imp(auditorMod)
  const s = audit({ behavioral: true }).summary
  assert.equal(s.RISK || 0, 0, "sem RISK")
  assert.equal(s.PLACEBO || 0, 0, "sem PLACEBO")
  assert.ok((s.REAL || 0) >= 4, `≥4 claims REAL agora (verify + os 3): veio ${s.REAL}`)
})
