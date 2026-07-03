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

test("Ruflo é executor opcional: plugin-lite, full init NÃO automático, não instala", async () => {
  const { RUFLO, detectRuflo, buildRufloReport } = await imp("src/harness/ruflo.js")
  assert.equal(RUFLO.role, "executor")
  assert.equal(RUFLO.fullInitRecommended, false)
  assert.equal(RUFLO.autoInstall, false)
  assert.equal(typeof detectRuflo(), "boolean")
  const rep = buildRufloReport()
  assert.equal(rep.fullInitRecommended, false)
  assert.equal(rep.pluginLiteAvailable, true)
})

test("Ruflo ausente não quebra o GStack (detect fail-open) e aparece como candidato", async () => {
  const { isCandidateAdapter, CANDIDATE_ADAPTERS } = await imp("src/agents/adapter-matrix.js")
  assert.equal(isCandidateAdapter("ruflo"), true)
  assert.equal(CANDIDATE_ADAPTERS.ruflo.role, "executor")
  // conformance segue limpo: ruflo NÃO está no ADAPTER_MATRIX iterado
  const { buildConformanceReport } = await imp("src/harness/conformance.js")
  assert.equal(buildConformanceReport().ok, true)
})

test("usuário escolhe canais: só `core` é default, resto opt-in", async () => {
  const { defaultRufloChannels, RUFLO_CHANNELS } = await imp("src/harness/ruflo.js")
  assert.deepEqual(defaultRufloChannels(), ["core"])
  const sensitive = RUFLO_CHANNELS.filter((c) => !c.safe).map((c) => c.id)
  assert.ok(sensitive.includes("agents") && sensitive.includes("federation"))
})

test("doctor --ruflo --json: JSON PURO, read-only, MCP default-deny", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-ruflo-"))
  try {
    const r = run(["doctor", "--ruflo", "--json"], { HOME: home, USERPROFILE: home })
    const d = JSON.parse(r.out)
    assert.equal(d.schemaVersion, "gstack.ruflo.v1")
    assert.equal(d.fullInitRecommended, false)
    assert.equal(d.mcpPolicy.default, "deny")
  } finally { rmSync(home, { recursive: true, force: true }) }
})
