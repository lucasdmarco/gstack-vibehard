import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.8 — Unified media-intake router: evita pipelines de vídeo
 * duplicados e minimiza tokens de frame. Default é transcript/captions
 * primeiro; frames só quando timestamp visual é necessário, sempre com
 * janela focada + dedupe + cap conservador — nunca "token-burner".
 */

test("selectMediaBackend: captions disponíveis e sem necessidade de timestamp visual -> transcript (default)", async () => {
  const { selectMediaBackend } = await imp("src/capabilities/media-intake.js")
  const r = selectMediaBackend({ captionsAvailable: true, visualTimestampNeeded: false, durationSeconds: 600 })
  assert.equal(r.backend, "transcript")
  assert.equal(r.frameBudget, 0, "transcript-first nunca gasta frame token à toa")
})

test("selectMediaBackend: timestamp visual necessário -> frames, mas SEMPRE com orçamento limitado", async () => {
  const { selectMediaBackend } = await imp("src/capabilities/media-intake.js")
  const r = selectMediaBackend({ captionsAvailable: true, visualTimestampNeeded: true, durationSeconds: 600 })
  assert.equal(r.backend, "frames")
  assert.ok(r.frameBudget > 0 && r.frameBudget <= 20, "orçamento conservador, nunca ilimitado")
})

test("selectMediaBackend: sem captions e sem necessidade de timestamp -> ainda tenta transcript (nunca pula direto pra frames)", async () => {
  const { selectMediaBackend } = await imp("src/capabilities/media-intake.js")
  const r = selectMediaBackend({ captionsAvailable: false, visualTimestampNeeded: false, durationSeconds: 300 })
  assert.equal(r.backend, "transcript")
})

test("selectMediaBackend: NUNCA seleciona um backend 'token-burner'", async () => {
  const { selectMediaBackend, DISALLOWED_BACKENDS } = await imp("src/capabilities/media-intake.js")
  assert.ok(DISALLOWED_BACKENDS.includes("token-burner"))
  for (const captionsAvailable of [true, false]) {
    for (const visualTimestampNeeded of [true, false]) {
      const r = selectMediaBackend({ captionsAvailable, visualTimestampNeeded, durationSeconds: 3600 })
      assert.ok(!DISALLOWED_BACKENDS.includes(r.backend))
    }
  }
})

test("boundedFrameBudget: cresce a duração, o orçamento continua limitado (nunca escala linear sem teto)", async () => {
  const { boundedFrameBudget } = await imp("src/capabilities/media-intake.js")
  const short = boundedFrameBudget({ durationSeconds: 60, cap: 20 })
  const long = boundedFrameBudget({ durationSeconds: 36000, cap: 20 })
  assert.ok(short <= 20 && long <= 20, "nunca ultrapassa o cap mesmo com vídeo de 10h")
})

test("dedupeFrames: frames idênticos (mesmo hash) contam 1x", async () => {
  const { dedupeFrames } = await imp("src/capabilities/media-intake.js")
  const frames = [Buffer.from("frameA"), Buffer.from("frameA"), Buffer.from("frameB")]
  const deduped = dedupeFrames(frames)
  assert.equal(deduped.length, 2)
})

test("requiresNetworkConsent: fonte remota (URL) exige consentimento; arquivo local não", async () => {
  const { requiresNetworkConsent } = await imp("src/capabilities/media-intake.js")
  assert.equal(requiresNetworkConsent({ sourceType: "url" }), true)
  assert.equal(requiresNetworkConsent({ sourceType: "local_file" }), false)
})

test("CONTROLE NEGATIVO: fonte URL sem consentimento explícito -> bloqueado, nunca baixa sozinho", async () => {
  const { canIngestSource } = await imp("src/capabilities/media-intake.js")
  const r = canIngestSource({ sourceType: "url", consented: false })
  assert.equal(r.ok, false)
  assert.equal(r.reason, "network_consent_required")
})

test("canIngestSource: arquivo local sempre ok sem exigir consentimento de rede", async () => {
  const { canIngestSource } = await imp("src/capabilities/media-intake.js")
  assert.equal(canIngestSource({ sourceType: "local_file", consented: false }).ok, true)
})

test("temporaryFileDisposition: política declarada -- delete_after_processing por default, retain_per_policy só explícito", async () => {
  const { temporaryFileDisposition } = await imp("src/capabilities/media-intake.js")
  assert.equal(temporaryFileDisposition({}), "delete_after_processing")
  assert.equal(temporaryFileDisposition({ retain: true }), "retain_per_policy")
})

test("routeMediaIntake: evidência completa -> decisão registra TODOS os campos de evidência do DoD", async () => {
  const { routeMediaIntake } = await imp("src/capabilities/media-intake.js")
  const decision = routeMediaIntake({
    sourceType: "local_file", questionType: "bug_repro", captionsAvailable: true,
    visualTimestampNeeded: false, durationSeconds: 120, projectedTextTokens: 800,
    projectedFrameTokens: 0, network: "none", retention: "delete_after_processing",
  })
  for (const f of ["sourceType", "questionType", "captionsAvailable", "visualTimestampNeeded", "durationSeconds", "projectedTextTokens", "projectedFrameTokens", "network", "retention", "selectedBackend"]) {
    assert.ok(f in decision, `evidência ${f} deve estar no registro de decisão`)
  }
})
