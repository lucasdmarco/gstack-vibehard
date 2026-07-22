import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const okProof = { schemaVersion: "gstack.proof.v1", ready: true, blockers: [], checks: { verify: { ok: true } } }

test("readinessContradicts: doctor diz true, readiness diz não-callable -> contradição real (GAP-8 do S47.0)", async () => {
  const { readinessContradicts } = await imp("src/project-plan/delivery-verdict.js")
  const c = readinessContradicts({ headroom: true }, { headroom: { status: "installed_not_callable" } })
  assert.equal(c.length, 1)
  assert.equal(c[0].tool, "headroom")
})

test("readinessContradicts: doctor e readiness concordam -> sem contradição", async () => {
  const { readinessContradicts } = await imp("src/project-plan/delivery-verdict.js")
  assert.deepEqual(readinessContradicts({ graphify: true }, { graphify: { status: "callable" } }), [])
})

test("deriveDeliveryVerdict: aceite P0 pendente (scorecard blocked) -> 'blocked', NUNCA 'delivered' (DoD)", async () => {
  const { deriveDeliveryVerdict } = await imp("src/project-plan/delivery-verdict.js")
  const proofWithP0Fail = { ...okProof, ready: true, checks: { verify: { ok: false } } }
  const r = deriveDeliveryVerdict({ intent: "delivery", proof: proofWithP0Fail, previewHealthy: true })
  assert.equal(r.status, "blocked")
})

test("deriveDeliveryVerdict: preview unhealthy -> checkpoint_ready, nunca delivered (DoD)", async () => {
  const { deriveDeliveryVerdict } = await imp("src/project-plan/delivery-verdict.js")
  const r = deriveDeliveryVerdict({ intent: "delivery", proof: okProof, previewHealthy: false })
  assert.equal(r.status, "checkpoint_ready")
  assert.match(r.reason, /preview unhealthy/)
})

test("deriveDeliveryVerdict: readiness contraditório -> checkpoint_ready, nunca delivered (DoD)", async () => {
  const { deriveDeliveryVerdict } = await imp("src/project-plan/delivery-verdict.js")
  const r = deriveDeliveryVerdict({
    intent: "delivery", proof: okProof, previewHealthy: true,
    doctorDeps: { headroom: true }, readinessTools: { headroom: { status: "missing" } },
  })
  assert.equal(r.status, "checkpoint_ready")
  assert.match(r.reason, /contradit/)
})

test("deriveDeliveryVerdict: proof bloqueado (ready:false) -> checkpoint_ready, nunca delivered (DoD)", async () => {
  const { deriveDeliveryVerdict } = await imp("src/project-plan/delivery-verdict.js")
  const r = deriveDeliveryVerdict({ intent: "delivery", proof: { ...okProof, ready: false }, previewHealthy: true })
  assert.equal(r.status, "checkpoint_ready")
})

test("deriveDeliveryVerdict: ciclo de desenvolvimento (intent!=delivery) -> checkpoint_ready mesmo com tudo verde", async () => {
  const { deriveDeliveryVerdict } = await imp("src/project-plan/delivery-verdict.js")
  const r = deriveDeliveryVerdict({ intent: "dev", proof: okProof, previewHealthy: true })
  assert.equal(r.status, "checkpoint_ready")
})

test("deriveDeliveryVerdict: TUDO verde + intent delivery -> delivered de verdade (caminho feliz)", async () => {
  const { deriveDeliveryVerdict } = await imp("src/project-plan/delivery-verdict.js")
  const r = deriveDeliveryVerdict({
    intent: "delivery", proof: okProof, previewHealthy: true,
    doctorDeps: { graphify: true }, readinessTools: { graphify: { status: "callable" } },
  })
  assert.equal(r.status, "delivered")
  assert.equal(r.contradictions.length, 0)
})

test("deriveDeliveryVerdict: score alto nunca esconde P0 (reusa delivery-scorecard.js real, não duplicado)", async () => {
  const { deriveDeliveryVerdict } = await imp("src/project-plan/delivery-verdict.js")
  const mostlyGreenButOneP0Fails = {
    ...okProof,
    checks: { verify: { ok: false }, dreamAudit: { ok: true }, gitTree: { ok: true }, skillGates: { ok: true } },
  }
  const r = deriveDeliveryVerdict({ intent: "delivery", proof: mostlyGreenButOneP0Fails, previewHealthy: true })
  assert.equal(r.status, "blocked", "3 de 4 verdes não basta — 1 P0 falho já bloqueia")
})

test("verifyProgressPolicy: intervalo dentro da policy -> ok:true", async () => {
  const { verifyProgressPolicy } = await imp("src/project-plan/delivery-verdict.js")
  const events = [{ at: "2026-01-01T00:00:00.000Z" }, { at: "2026-01-01T00:00:05.000Z" }, { at: "2026-01-01T00:00:10.000Z" }]
  const r = verifyProgressPolicy(events, 15000)
  assert.equal(r.ok, true)
})

test("verifyProgressPolicy: gap além da policy -> ok:false, silêncio NUNCA passa despercebido (DoD)", async () => {
  const { verifyProgressPolicy } = await imp("src/project-plan/delivery-verdict.js")
  const events = [{ at: "2026-01-01T00:00:00.000Z" }, { at: "2026-01-01T00:01:00.000Z" }] // 60s de silêncio
  const r = verifyProgressPolicy(events, 15000)
  assert.equal(r.ok, false)
  assert.equal(r.gaps.length, 1)
  assert.equal(r.gaps[0].ms, 60000)
})

test("verifyProgressPolicy: sem eventos ou só 1 -> ok:true (nada a comparar)", async () => {
  const { verifyProgressPolicy } = await imp("src/project-plan/delivery-verdict.js")
  assert.equal(verifyProgressPolicy([]).ok, true)
  assert.equal(verifyProgressPolicy([{ at: "2026-01-01T00:00:00.000Z" }]).ok, true)
})
