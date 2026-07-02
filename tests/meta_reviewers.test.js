import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const mod = path.resolve(import.meta.dirname, "..", "src", "meta", "reviewers.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("parseVerdict: OK/RISK parseados; ilegível = sem sinal (nunca inventa)", async () => {
  const { parseVerdict } = await imp()
  assert.equal(parseVerdict("VERDICT: OK\n- limpo").ok, true)
  assert.equal(parseVerdict("verdict: risk\n- segredo no diff").flagged, true)
  const noSignal = parseVerdict("blá blá sem veredito")
  assert.equal(noSignal.ok, true, "sem sinal não bloqueia (gate decide)")
  assert.match(noSignal.note, /ilegível/)
})

test("buildReviewer: binário ausente → deterministic_only declarado (nunca OK falso)", async () => {
  const { buildReviewer } = await imp()
  const execFail = () => { throw new Error("ENOENT") }
  const r = buildReviewer("opencode", { exec: execFail })
  assert.equal(r.available, false)
  assert.equal(r.mode, "deterministic_only")
  assert.match(r.note, /não encontrado/)
})

test("buildReviewer: id desconhecido e id vazio → indisponível com nota", async () => {
  const { buildReviewer } = await imp()
  assert.equal(buildReviewer("gemini-xyz", {}).available, false)
  assert.equal(buildReviewer(null, {}).available, false)
})

test("buildReviewer: disponível → review parseia veredito do binário", async () => {
  const { buildReviewer } = await imp()
  const calls = []
  const exec = (file, args) => {
    calls.push([file, args[0]])
    if (args[0] === "--version") return "1.0.0"
    return "VERDICT: RISK\n- token hardcoded"
  }
  const r = buildReviewer("opencode", { exec })
  assert.equal(r.available, true)
  const verdict = r.review({ id: "s1" }, { diff: "+const t = 'x'" })
  assert.equal(verdict.flagged, true)
  assert.deepEqual(calls[1], ["opencode", "run"], "invoca opencode run <prompt>")
})

test("buildReviewer: review que LANÇA vira sem-sinal degradado (fail-soft, nunca crash)", async () => {
  const { buildReviewer } = await imp()
  const exec = (file, args) => {
    if (args[0] === "--version") return "1.0.0"
    throw new Error("timeout")
  }
  const r = buildReviewer("opencode", { exec })
  const verdict = r.review({ id: "s1" }, {})
  assert.equal(verdict.ok, true, "erro não vira bloqueio nem aprovação — sem sinal")
  assert.equal(verdict.degraded, true)
  assert.match(verdict.note, /cobertura reduzida/)
})

test("buildReviewPrompt: trunca diff e exige veredito na primeira linha", async () => {
  const { buildReviewPrompt } = await imp()
  const p = buildReviewPrompt({ id: "s9" }, { diff: "x".repeat(9000) })
  assert.ok(p.length < 5000, "diff truncado em ~4000")
  assert.match(p, /VERDICT: OK/)
  assert.match(p, /s9/)
})
