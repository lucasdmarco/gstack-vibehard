import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD50 S50.3 — adaptador do Loop Engine (§11.2).
 *
 * A regra que dá nome ao sprint: **NUNCA mapear `runStatus=passed` para
 * `epistemicVerdict=supported`**. São dois eixos diferentes — um diz se o
 * protocolo rodou, o outro diz o que a evidência mostrou.
 */

test("§11.2: o mapeamento PVEP -> Loop Engine usa os nós que JÁ existem", async () => {
  const { PVEP_TO_LOOP_ENGINE } = await imp("src/epistemic/workflow-adapter.js")
  assert.equal(PVEP_TO_LOOP_ENGINE.decompose, "planner")
  assert.equal(PVEP_TO_LOOP_ENGINE.sufficiencyCriteria, "rubric")
  assert.equal(PVEP_TO_LOOP_ENGINE.buildSupport, "worker")
  assert.equal(PVEP_TO_LOOP_ENGINE.seekRefutation, "verifier")
  assert.equal(PVEP_TO_LOOP_ENGINE.smallFix, "retry")
  assert.equal(PVEP_TO_LOOP_ENGINE.insufficientEvidence, "human_handoff")
})

// --- o invariante central do sprint ---
test("CONTROLE NEGATIVO: runStatus 'passed' NÃO vira epistemicVerdict 'supported'", async () => {
  const { toEpistemicOutcome } = await imp("src/epistemic/workflow-adapter.js")
  const r = toEpistemicOutcome({ runStatus: "passed", claims: [{ status: "inconclusive" }] })
  assert.equal(r.runStatus, "passed", "o run realmente passou")
  assert.equal(r.epistemicVerdict, "inconclusive", "mas a evidência não sustentou nada")
  assert.notEqual(r.epistemicVerdict, "supported")
})

test("CONTROLE NEGATIVO: run 'instructed' (nenhum trabalho real) NUNCA sustenta claim", async () => {
  const { toEpistemicOutcome } = await imp("src/epistemic/workflow-adapter.js")
  const r = toEpistemicOutcome({
    runStatus: "instructed",
    claims: [{ status: "supported", support: [{ sourceId: "s1" }] }],
  })
  assert.equal(r.epistemicVerdict, "inconclusive", "sem execução real, nada é sustentado")
  assert.ok(r.notPerformed.some((n) => /nenhum trabalho/i.test(n)))
})

test("runStatus 'failed' -> verdict inconclusive e o motivo fica registrado", async () => {
  const { toEpistemicOutcome } = await imp("src/epistemic/workflow-adapter.js")
  const r = toEpistemicOutcome({ runStatus: "failed", claims: [{ status: "supported", support: [{ sourceId: "s" }] }] })
  assert.equal(r.epistemicVerdict, "inconclusive")
})

test("caminho feliz: run executou de verdade E a evidência sustenta -> supported", async () => {
  const { toEpistemicOutcome } = await imp("src/epistemic/workflow-adapter.js")
  const r = toEpistemicOutcome({ runStatus: "passed", claims: [{ status: "supported", support: [{ sourceId: "s1", excerpt: "t" }] }] })
  assert.equal(r.epistemicVerdict, "supported")
})

// --- self-review nunca prova (DoD do sprint) ---
test("CONTROLE NEGATIVO: gerador e verificador CONCORDANDO não promove a prova", async () => {
  const { toEpistemicOutcome } = await imp("src/epistemic/workflow-adapter.js")
  const r = toEpistemicOutcome({
    runStatus: "passed",
    claims: [{ status: "supported", support: [{ sourceId: "self:verifier", excerpt: "eu concordo" }] }],
    verifierAgreement: true,
  })
  assert.equal(r.selfReviewCountedAsProof, false, "autoconcordância nunca é prova (§2.3.1)")
  assert.equal(r.evidenceLedgerStatus, "advisory", "vai pro ledger como advisory, jamais proved")
})

test("verifier independente em EV2 é ADVISORY, nunca gate", async () => {
  const { independentVerifierRole } = await imp("src/epistemic/workflow-adapter.js")
  assert.equal(independentVerifierRole("adversarial"), "advisory")
  assert.equal(independentVerifierRole("grounded"), "advisory")
  assert.equal(independentVerifierRole("sanity"), "not_used", "EV0 não usa verificador extra")
})

// --- caps, same-failure e handoff determinísticos ---
test("§11.3: caps de iteração por nível são determinísticos", async () => {
  const { iterationCapFor } = await imp("src/epistemic/workflow-adapter.js")
  assert.equal(iterationCapFor("sanity"), 1)
  assert.equal(iterationCapFor("grounded"), 2)
  assert.equal(iterationCapFor("adversarial"), 3)
})

test("stopReason: cap atingido -> 'cap' + handoff, nunca conclusão silenciosa", async () => {
  const { resolveStopReason } = await imp("src/epistemic/workflow-adapter.js")
  const r = resolveStopReason({ iterations: 3, cap: 3, sameFailureCount: 0, sufficient: false })
  assert.equal(r.stopReason, "cap")
  assert.equal(r.handoff, true)
})

test("stopReason: mesma falha repetida -> 'same_failure' + handoff", async () => {
  const { resolveStopReason } = await imp("src/epistemic/workflow-adapter.js")
  const r = resolveStopReason({ iterations: 2, cap: 3, sameFailureCount: 2, sufficient: false })
  assert.equal(r.stopReason, "same_failure")
  assert.equal(r.handoff, true)
})

test("stopReason: evidência suficiente -> early stop 'sufficient', SEM handoff", async () => {
  const { resolveStopReason } = await imp("src/epistemic/workflow-adapter.js")
  const r = resolveStopReason({ iterations: 1, cap: 3, sameFailureCount: 0, sufficient: true })
  assert.equal(r.stopReason, "sufficient")
  assert.equal(r.handoff, false)
})

test("stopReason: sem evidência e sem cap -> insufficient_data (abstenção honesta)", async () => {
  const { resolveStopReason } = await imp("src/epistemic/workflow-adapter.js")
  const r = resolveStopReason({ iterations: 1, cap: 3, sameFailureCount: 0, sufficient: false, exhausted: true })
  assert.equal(r.stopReason, "insufficient_data")
})

// --- replay não duplica trabalho concluído (DoD) ---
test("replay: fonte já hasheada e fresca NÃO é recontada", async () => {
  const { dedupeCompletedWork } = await imp("src/epistemic/workflow-adapter.js")
  const prior = { sourceHashes: ["sha256:aaa"], modelCalls: 1 }
  const r = dedupeCompletedWork({ prior, incoming: { sourceHashes: ["sha256:aaa", "sha256:bbb"], modelCalls: 1 } })
  assert.deepEqual(r.newSourceHashes, ["sha256:bbb"], "só a fonte nova conta")
  assert.equal(r.additionalModelCalls, 0, "model call já concluído não é refeito")
})

test("replay: nada novo -> zero trabalho adicional", async () => {
  const { dedupeCompletedWork } = await imp("src/epistemic/workflow-adapter.js")
  const r = dedupeCompletedWork({ prior: { sourceHashes: ["sha256:aaa"], modelCalls: 2 }, incoming: { sourceHashes: ["sha256:aaa"], modelCalls: 2 } })
  assert.deepEqual(r.newSourceHashes, [])
  assert.equal(r.additionalModelCalls, 0)
})
