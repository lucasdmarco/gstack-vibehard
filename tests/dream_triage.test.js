import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("classify: sem evidência -> undetermined, nunca skill/memory/skip", async () => {
  const { classify } = await imp("src/dream/triage.js")
  assert.equal(classify({ hasEvidence: false, stepCount: 5, recurring: true, verifiable: true }), "undetermined")
})

test("classify: one-off -> skip, mesmo com evidência e passos", async () => {
  const { classify } = await imp("src/dream/triage.js")
  assert.equal(classify({ hasEvidence: true, oneOff: true, stepCount: 3, recurring: true, verifiable: true }), "skip")
})

test("classify: passing check ausente (verifiable=false) -> memory, não skill", async () => {
  const { classify } = await imp("src/dream/triage.js")
  assert.equal(classify({ hasEvidence: true, stepCount: 3, recurring: true, verifiable: false }), "memory")
})

test("classify: procedimento de uma linha -> memory (não vira skill só com 1 passo)", async () => {
  const { classify } = await imp("src/dream/triage.js")
  assert.equal(classify({ hasEvidence: true, stepCount: 1, recurring: true, verifiable: true }), "memory")
})

test("classify: procedimento recorrente, verificável e com 2+ passos -> skill", async () => {
  const { classify } = await imp("src/dream/triage.js")
  assert.equal(classify({ hasEvidence: true, stepCount: 3, recurring: true, verifiable: true }), "skill")
})

test("classify: NUNCA usa popularidade/tamanho de texto como critério — só os sinais tipados", async () => {
  const { classify } = await imp("src/dream/triage.js")
  // sinais idênticos exceto por um campo estranho ("popularity") não influenciam o resultado
  const a = classify({ hasEvidence: true, stepCount: 3, recurring: true, verifiable: true })
  const b = classify({ hasEvidence: true, stepCount: 3, recurring: true, verifiable: true, popularity: 999999 })
  assert.equal(a, b)
})

test("deriveStatus: sem evidência nunca vira eligible (fica tentative ou skipped)", async () => {
  const { deriveStatus } = await imp("src/dream/triage.js")
  const r1 = deriveStatus({ hasEvidence: false, stepCount: 5, recurring: true, verifiable: true })
  assert.equal(r1.status, "tentative")
  assert.notEqual(r1.status, "eligible")
  const r2 = deriveStatus({ hasEvidence: true, oneOff: true })
  assert.equal(r2.status, "skipped")
})

test("deriveStatus: passing check ausente -> tentative (nunca eligible sem verificação)", async () => {
  const { deriveStatus } = await imp("src/dream/triage.js")
  const r = deriveStatus({ hasEvidence: true, stepCount: 3, recurring: true, verifiable: false })
  assert.equal(r.status, "tentative")
})

test("deriveStatus: skill/memory com evidência + passing check -> eligible", async () => {
  const { deriveStatus } = await imp("src/dream/triage.js")
  const r = deriveStatus({ hasEvidence: true, stepCount: 3, recurring: true, verifiable: true })
  assert.equal(r.classification, "skill")
  assert.equal(r.status, "eligible")
})
