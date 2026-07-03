import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const bin = path.join(repoRoot, "src", "index.js")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

function run(args, env = {}) {
  try { return { code: 0, out: execFileSync("node", [bin, ...args], { encoding: "utf-8", env: { ...process.env, ...env }, stdio: "pipe" }) } }
  catch (e) { return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + "" } }
}

test("Codebuff é reviewer advisory com risco externo declarado — nunca gate final", async () => {
  const { CODEBUFF, detectCodebuff } = await imp("src/harness/codebuff.js")
  assert.equal(CODEBUFF.enforcement, "advisory_reviewer")
  assert.equal(CODEBUFF.reviewerOnly, true)
  assert.equal(CODEBUFF.externalModelRisk, true)
  assert.equal(CODEBUFF.networkRequired, true)
  assert.ok(CODEBUFF.disclosure.length >= 2)
  // detecção read-only não lança e devolve boolean
  assert.equal(typeof detectCodebuff(), "boolean")
})

test("candidatos NÃO entram no ADAPTER_MATRIX (conformance intacto), mas são candidateAdapter", async () => {
  const { ADAPTER_MATRIX, isCandidateAdapter, CANDIDATE_ADAPTERS } = await imp("src/agents/adapter-matrix.js")
  assert.equal(ADAPTER_MATRIX.codebuff, undefined, "codebuff não pode contaminar a matrix de harnesses instaláveis")
  assert.equal(ADAPTER_MATRIX.freebuff, undefined)
  assert.equal(isCandidateAdapter("codebuff"), true)
  assert.equal(CANDIDATE_ADAPTERS.codebuff.enforcement, "advisory_reviewer")
  // conformance segue OK (a matrix não ganhou drift)
  const { buildConformanceReport } = await imp("src/harness/conformance.js")
  assert.equal(buildConformanceReport().ok, true)
})

test("buildCandidateReport é read-only e nunca auto-instala", async () => {
  const { buildCandidateReport } = await imp("src/harness/candidates.js")
  const r = buildCandidateReport()
  assert.equal(r.readonly, true)
  assert.equal(r.autoInstall, false)
  const cb = r.candidates.find((c) => c.id === "codebuff")
  assert.ok(cb, "codebuff no relatório")
  assert.equal(cb.autoInstall, false)
  assert.equal(cb.enforcement, "advisory_reviewer")
  assert.ok(r.candidates.some((c) => c.id === "freebuff"))
})

test("doctor --candidates --json: JSON PURO com riscos e enforcement level", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-cand-"))
  try {
    const r = run(["doctor", "--candidates", "--json"], { HOME: home, USERPROFILE: home })
    const d = JSON.parse(r.out) // não lança = JSON puro
    assert.equal(d.schemaVersion, "gstack.candidates.v1")
    assert.equal(d.readonly, true)
    const cb = d.candidates.find((c) => c.id === "codebuff")
    assert.equal(cb.enforcement, "advisory_reviewer")
    assert.equal(cb.externalModelRisk, true)
    assert.ok(Array.isArray(cb.disclosure) && cb.disclosure.length)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
