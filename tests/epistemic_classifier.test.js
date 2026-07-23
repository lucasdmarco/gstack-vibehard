import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/** PRD50 S50.1 — classificador determinístico EV0/EV1/EV2 (§9). */

test("§9.2: pergunta local, reversível, sem fato externo -> sanity (EV0)", async () => {
  const { classifyLevel } = await imp("src/epistemic/classifier.js")
  const r = classifyLevel({ localOnly: true, reversible: true, externalInfoNeeded: false, shortAnswer: true })
  assert.equal(r.level, "sanity")
  assert.ok(r.reasons.length > 0, "classificação sempre diz POR QUE")
})

test("§9.2: claim sobre código/arquitetura/comportamento do produto -> grounded (EV1)", async () => {
  const { classifyLevel } = await imp("src/epistemic/classifier.js")
  assert.equal(classifyLevel({ codeClaim: true }).level, "grounded")
  assert.equal(classifyLevel({ factualClaim: true }).level, "grounded")
})

test("§9.2: informação externa/temporalmente instável -> grounded + exige source grounding", async () => {
  const { classifyLevel } = await imp("src/epistemic/classifier.js")
  const r = classifyLevel({ externalInfoNeeded: true })
  assert.equal(r.level, "grounded")
  assert.equal(r.requiresSourceGrounding, true)
})

test("§9.2: segurança/release/secrets/irreversível -> adversarial (EV2)", async () => {
  const { classifyLevel } = await imp("src/epistemic/classifier.js")
  for (const sig of ["securityImpact", "releaseImpact", "touchesSecrets", "irreversible", "supplyChain"]) {
    assert.equal(classifyLevel({ [sig]: true }).level, "adversarial", `${sig} -> EV2`)
  }
})

test("§9.2: novidade/claim extraordinária -> adversarial + expert required", async () => {
  const { classifyLevel } = await imp("src/epistemic/classifier.js")
  const r = classifyLevel({ noveltyClaim: true })
  assert.equal(r.level, "adversarial")
  assert.equal(r.expertRequired, true)
})

test("§9.2: fontes conflitantes -> permite inconclusive explicitamente", async () => {
  const { classifyLevel } = await imp("src/epistemic/classifier.js")
  const r = classifyLevel({ conflictingSources: true })
  assert.ok(["grounded", "adversarial"].includes(r.level))
  assert.equal(r.mayBeInconclusive, true)
})

test("CONTROLE NEGATIVO §9.3: SEM sinal nenhum falha para GROUNDED, nunca para sanity", async () => {
  const { classifyLevel } = await imp("src/epistemic/classifier.js")
  const r = classifyLevel({})
  assert.equal(r.level, "grounded", "ausência de classificação é fail-safe para EV1 (§9.3), nunca EV0")
  assert.match(r.reasons.join(" "), /sem sinal/i)
})

test("determinismo: mesmos sinais -> exatamente o mesmo resultado", async () => {
  const { classifyLevel } = await imp("src/epistemic/classifier.js")
  const sig = { codeClaim: true, externalInfoNeeded: true }
  assert.deepEqual(classifyLevel(sig), classifyLevel(sig))
})

// --- override (§9.3) ---
test("§9.3: usuário pode ELEVAR o nível livremente", async () => {
  const { resolveLevel } = await imp("src/epistemic/classifier.js")
  const r = resolveLevel({ classified: "sanity", requested: "adversarial" })
  assert.equal(r.level, "adversarial")
  assert.equal(r.downgraded, false)
})

test("CONTROLE NEGATIVO §9.3: rebaixar EV2 SEM confirmação explícita é RECUSADO", async () => {
  const { resolveLevel } = await imp("src/epistemic/classifier.js")
  const r = resolveLevel({ classified: "adversarial", requested: "sanity" })
  assert.equal(r.level, "adversarial", "alto risco nunca é rebaixado silenciosamente")
  assert.equal(r.downgradeRefused, true)
})

test("CONTROLE NEGATIVO §9.3: rebaixamento confirmado PROÍBE claim 'verified'", async () => {
  const { resolveLevel } = await imp("src/epistemic/classifier.js")
  const r = resolveLevel({ classified: "adversarial", requested: "grounded", confirmedDowngrade: true })
  assert.equal(r.level, "grounded")
  assert.equal(r.downgraded, true)
  assert.equal(r.mayClaimVerified, false, "resultado rebaixado NUNCA pode alegar verificação")
  assert.ok(r.riskReceipt, "rebaixamento exige receipt com os riscos")
})

test("'auto' usa a classificação; nível desconhecido cai no fail-safe grounded", async () => {
  const { resolveLevel } = await imp("src/epistemic/classifier.js")
  assert.equal(resolveLevel({ classified: "grounded", requested: "auto" }).level, "grounded")
  assert.equal(resolveLevel({ classified: "grounded", requested: "turbo" }).level, "grounded")
})

// --- o corpus real do S50.0 é classificado como esperado ---
test("CORPUS REAL: cada caso é classificado no nível que o gabarito declara", async () => {
  const { classifyLevel, signalsFromCorpusCase } = await imp("src/epistemic/classifier.js")
  const corpus = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "epistemic", "corpus.json"), "utf-8"))
  for (const c of corpus.cases) {
    const got = classifyLevel(signalsFromCorpusCase(c)).level
    assert.equal(got, c.expectedLevel, `${c.id}: esperado ${c.expectedLevel}, veio ${got}`)
  }
})
