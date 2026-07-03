import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("Freebuff exige aceite e traz disclosure reforçado (rede/anúncios/modelos externos)", async () => {
  const { FREEBUFF, detectFreebuff } = await imp("src/harness/freebuff.js")
  assert.equal(FREEBUFF.enforcement, "advisory_reviewer")
  assert.equal(FREEBUFF.requiresAcceptance, true, "aceite obrigatório")
  assert.equal(FREEBUFF.externalModelRisk, true)
  assert.equal(FREEBUFF.networkRequired, true)
  const blob = FREEBUFF.disclosure.join(" ").toLowerCase()
  assert.match(blob, /rede/)
  assert.match(blob, /an[úu]ncio/)
  assert.match(blob, /externo/)
  assert.equal(typeof detectFreebuff(), "boolean")
})

test("Freebuff nunca é enforcement/gate — só reviewer advisory", async () => {
  const { FREEBUFF } = await imp("src/harness/freebuff.js")
  assert.equal(FREEBUFF.reviewerOnly, true)
  // nunca aparece como enforced no vocabulário de enforcement real
  assert.notEqual(FREEBUFF.enforcement, "real_hooks")
  assert.notEqual(FREEBUFF.enforcement, "enforced")
})

test("relatório de candidatos: Freebuff presente com requiresAcceptance e sem auto-install", async () => {
  const { buildCandidateReport } = await imp("src/harness/candidates.js")
  const fb = buildCandidateReport().candidates.find((c) => c.id === "freebuff")
  assert.ok(fb)
  assert.equal(fb.requiresAcceptance, true)
  assert.equal(fb.autoInstall, false)
  assert.ok(fb.disclosure.length >= 3)
})

test("shellCompat + delegateBlocked são coerentes com a plataforma", async () => {
  const { buildCandidateReport, shellCompat } = await imp("src/harness/candidates.js")
  const rep = buildCandidateReport()
  const sh = shellCompat()
  // fora do Windows, shell sempre ok e delegate nunca bloqueado por shell
  if (process.platform !== "win32") {
    assert.equal(sh.ok, true)
    for (const c of rep.candidates) assert.equal(c.delegateBlocked, false)
  } else {
    // no Windows, se bloqueado, precisa vir com mensagem útil
    for (const c of rep.candidates) if (c.delegateBlocked) assert.match(c.delegateBlockReason, /Git Bash|WSL/)
  }
})
