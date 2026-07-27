import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "tools", "headroom-status.js")
const toolsMod = path.join(repoRoot, "src", "commands", "tools.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

/**
 * PRD51 S51.5.5 (ação #10) — as 6 dimensões (binário/comando/proxy/harness
 * roteado/tráfego provado/economia) já existiam espalhadas em readiness.js
 * (probeHeadroom) e headroom-traffic.js (proveRouting), nunca unificadas.
 */

test("buildHeadroomStatus: missing -> só dimensão 1 (binário) é false, resto honesto/vazio", async () => {
  const { buildHeadroomStatus } = await imp()
  const s = buildHeadroomStatus({ readinessEntry: { status: "missing" }, proof: null })
  assert.equal(s.binaryFound, false)
  assert.equal(s.commandResponds, false)
  assert.equal(s.proxyHealthy, false)
  assert.equal(s.harnessRouted, null)
  assert.equal(s.trafficProven, false)
  assert.equal(s.savingsObserved, null)
})

test("buildHeadroomStatus: installed_not_callable -> binário TRUE (achou o arquivo), comando FALSE (não respondeu)", async () => {
  const { buildHeadroomStatus } = await imp()
  const s = buildHeadroomStatus({ readinessEntry: { status: "installed_not_callable" }, proof: null })
  assert.equal(s.binaryFound, true)
  assert.equal(s.commandResponds, false)
})

test("buildHeadroomStatus: callable_not_routed -> dims 1-2 true, proxy/harness/tráfego/economia honestos (não fabricados)", async () => {
  const { buildHeadroomStatus } = await imp()
  const s = buildHeadroomStatus({
    readinessEntry: { status: "callable_not_routed", routing: { proxyRunning: false, byHarness: {} } },
    proof: { state: "proxy_off", economyClaimable: false },
  })
  assert.equal(s.binaryFound, true)
  assert.equal(s.commandResponds, true)
  assert.equal(s.proxyHealthy, false)
  assert.equal(s.trafficProven, false)
  assert.equal(s.savingsObserved, null)
})

test("buildHeadroomStatus: routed + tráfego provado -> as 6 dimensões TODAS positivas com economia real", async () => {
  const { buildHeadroomStatus } = await imp()
  const s = buildHeadroomStatus({
    readinessEntry: { status: "routed", routing: { proxyRunning: true, byHarness: { claude: "routed", codex: "not_routed" } } },
    proof: { state: "routed_proven", economyClaimable: true, savings: { tokensSaved: 500, savingsPercent: 12.5 } },
  })
  assert.equal(s.binaryFound, true)
  assert.equal(s.commandResponds, true)
  assert.equal(s.proxyHealthy, true)
  assert.deepEqual(s.harnessRouted, { claude: "routed", codex: "not_routed" })
  assert.equal(s.trafficProven, true)
  assert.deepEqual(s.savingsObserved, { tokensSaved: 500, savingsPercent: 12.5 })
})

// PRD51 S51.5.5 — controle negativo: proxy rodando mas SEM chamada real ainda
// (routed_no_traffic) NUNCA afirma tráfego provado nem economia (não é enfeite).
test("buildHeadroomStatus: CONTROLE NEGATIVO -- routed_no_traffic NUNCA vira trafficProven/economia", async () => {
  const { buildHeadroomStatus } = await imp()
  const s = buildHeadroomStatus({
    readinessEntry: { status: "routed", routing: { proxyRunning: true, byHarness: { claude: "routed" } } },
    proof: { state: "routed_no_traffic", economyClaimable: false },
  })
  assert.equal(s.trafficProven, false)
  assert.equal(s.savingsObserved, null)
})

// CLI real: `tools headroom summary`
test("tools headroom summary --json: CLI real compõe readiness + proveRouting injetado", async () => {
  const { toolsCommand } = await import(`${pathToFileURL(toolsMod)}?t=${Date.now()}`)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-hsummary-"))
  try {
    const hdir = path.join(cwd, ".gstack", "tools", "headroom-venv", process.platform === "win32" ? "Scripts" : "bin")
    await mkdir(hdir, { recursive: true })
    await writeFile(path.join(hdir, process.platform === "win32" ? "headroom.exe" : "headroom"), "")
    const probe = (file, args) => {
      const key = `${path.basename(String(file)).replace(/\.(cmd|exe|bat)$/i, "")} ${(args || [])[0] || ""}`.trim()
      if (key === "headroom --version") return { ok: true, code: 0, stdout: "headroom 0.28.0", stderr: "" }
      if (key === "headroom doctor") return { ok: true, code: 0, stdout: "Proxy running on :7070; harness routed", stderr: "" }
      return { ok: false, code: null, stdout: "", stderr: "not found" }
    }
    const opts = { cwd, home: cwd, probe, git: () => "h", proveRouting: () => ({ state: "routed_proven", economyClaimable: true, savings: { tokensSaved: 42, savingsPercent: 5 } }) }
    const orig = process.stdout.write.bind(process.stdout)
    let out = ""
    process.stdout.write = (s) => { out += s; return true }
    try { await toolsCommand(["headroom", "summary", "--json"], opts) } finally { process.stdout.write = orig }
    const parsed = JSON.parse(out)
    assert.equal(parsed.schemaVersion, "gstack.headroom.status.v1")
    assert.equal(parsed.proxyHealthy, true)
    assert.equal(parsed.trafficProven, true)
    assert.deepEqual(parsed.savingsObserved, { tokensSaved: 42, savingsPercent: 5 })
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
