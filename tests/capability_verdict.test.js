import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "meta", "capability-verdict.js")
const toolsMod = path.join(repoRoot, "src", "commands", "tools.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

function makeProbe(table) {
  return (file, args) => {
    const key = `${path.basename(String(file)).replace(/\.(cmd|exe|bat)$/i, "")} ${(args || [])[0] || ""}`.trim()
    return table[key] || { ok: false, code: null, stdout: "", stderr: "not found" }
  }
}

/**
 * PRD51 S51.5.4 (ação #9) — `tools readiness` e `agents doctor` eram dois
 * sistemas totalmente separados, podendo discordar em silêncio. Escopo
 * honesto: só esses dois (a ação #9 não nomeia `tools doctor`/printing-press).
 */

const READY_OK = { tools: { fallow: { status: "callable" }, graphify: { status: "callable" }, headroom: { status: "callable_not_routed" } } }
const AGENTS_OK = { ok: true, drift: null, contract: { checked: 3, missing: 0 }, scorecard: { ok: true, errors: [] }, compilerVersion: "1.2.3" }

test("buildCapabilityVerdict: os dois OK -> ok:true", async () => {
  const { buildCapabilityVerdict } = await imp()
  const v = buildCapabilityVerdict({ readiness: READY_OK, agentsDoctor: AGENTS_OK })
  assert.equal(v.ok, true)
  assert.equal(v.tools.ok, true)
  assert.equal(v.agents.ok, true)
})

test("buildCapabilityVerdict: headroom 'callable_not_routed' NUNCA bloqueia (routing é sempre opt-in)", async () => {
  const { buildCapabilityVerdict } = await imp()
  const v = buildCapabilityVerdict({ readiness: READY_OK, agentsDoctor: AGENTS_OK })
  assert.deepEqual(v.tools.blockers, [])
})

test("buildCapabilityVerdict: CONTROLE NEGATIVO -- fallow 'missing' bloqueia tools.ok e o veredito geral", async () => {
  const { buildCapabilityVerdict } = await imp()
  const readiness = { tools: { fallow: { status: "missing" }, graphify: { status: "callable" } } }
  const v = buildCapabilityVerdict({ readiness, agentsDoctor: AGENTS_OK })
  assert.equal(v.tools.ok, false)
  assert.deepEqual(v.tools.blockers, [{ tool: "fallow", status: "missing" }])
  assert.equal(v.ok, false, "tools bloqueado -> veredito geral false, mesmo com agents ok")
})

test("buildCapabilityVerdict: CONTROLE NEGATIVO -- agents doctor com drift bloqueia agents.ok e o veredito geral, mesmo com tools ok", async () => {
  const { buildCapabilityVerdict } = await imp()
  const agentsDoctor = { ok: false, drift: "generated fora de sincronia", contract: { checked: 3, missing: 0 }, scorecard: { ok: true, errors: [] }, compilerVersion: "1.2.3" }
  const v = buildCapabilityVerdict({ readiness: READY_OK, agentsDoctor })
  assert.equal(v.agents.ok, false)
  assert.ok(v.agents.reasons.some((r) => r.includes("drift")))
  assert.equal(v.ok, false, "agents bloqueado -> veredito geral false, mesmo com tools ok")
})

test("buildCapabilityVerdict: agents doctor ausente (manifest nunca buildado) -> reason honesta, nunca finge ok", async () => {
  const { buildCapabilityVerdict } = await imp()
  const v = buildCapabilityVerdict({ readiness: READY_OK, agentsDoctor: null })
  assert.equal(v.agents.ok, false)
  assert.deepEqual(v.agents.reasons, ["agents doctor não rodou"])
})

test("buildCapabilityVerdict: declara honestamente que printing-press doctor fica FORA do escopo", async () => {
  const { buildCapabilityVerdict } = await imp()
  const v = buildCapabilityVerdict({ readiness: READY_OK, agentsDoctor: AGENTS_OK })
  assert.deepEqual(v.excludedFromScope, ["printing-press-doctor"])
})

// CLI real: `tools verdict` reconcilia buildReadiness + computeAgentsDoctor
// (agentsDoctor injetável via opts, mesmo padrão de probe/git/now do resto de tools.js).
test("tools verdict: CLI real chama buildReadiness + reconcilia com agentsDoctor injetado", async () => {
  const { toolsCommand } = await import(`${pathToFileURL(toolsMod)}?t=${Date.now()}`)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-verdict-"))
  try {
    const probe = makeProbe({ "npx fallow": { ok: true, code: 0, stdout: "fallow 2", stderr: "" } })
    const opts = { cwd, home: cwd, probe, git: () => "h", now: () => "t", agentsDoctor: AGENTS_OK }
    const orig = process.stdout.write.bind(process.stdout)
    let out = ""
    process.stdout.write = (s) => { out += s; return true }
    try { await toolsCommand(["verdict", "--json"], opts) } finally { process.stdout.write = orig }
    const parsed = JSON.parse(out)
    assert.equal(parsed.schemaVersion, "gstack.capability-verdict.v1")
    assert.equal(parsed.agents.ok, true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
