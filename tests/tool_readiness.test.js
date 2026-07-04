import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const readyMod = path.join(repoRoot, "src", "tools", "readiness.js")
const toolsMod = path.join(repoRoot, "src", "commands", "tools.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

// probe mock: mapeia "file arg0" → { ok, code, stdout, stderr }. Determinístico.
function makeProbe(table) {
  return (file, args) => {
    const key = `${path.basename(String(file)).replace(/\.(cmd|exe|bat)$/i, "")} ${(args || [])[0] || ""}`.trim()
    return table[key] || { ok: false, code: null, stdout: "", stderr: "not found" }
  }
}

test("buildReadiness: fallow callable, headroom callable_not_routed (doctor sem 'routed')", async () => {
  const { buildReadiness } = await imp(readyMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    const probe = makeProbe({
      "node --version": { ok: true, code: 0, stdout: "v20.0.0", stderr: "" },
      "npx fallow": { ok: true, code: 0, stdout: "fallow 2.104.0", stderr: "" },
      "graphify --version": { ok: true, code: 0, stdout: "graphify 0.8.0", stderr: "" },
      // headroom --version ok, mas doctor NÃO diz "routed" → callable_not_routed
      "headroom --version": { ok: true, code: 0, stdout: "headroom 0.28.0", stderr: "" },
      "headroom doctor": { ok: true, code: 0, stdout: "proxy stopped; not routed", stderr: "" },
    })
    // headroom precisa do arquivo existir para não ser "missing"
    const hdir = path.join(cwd, ".gstack", "tools", "headroom-venv", process.platform === "win32" ? "Scripts" : "bin")
    await mkdir(hdir, { recursive: true })
    await writeFile(path.join(hdir, process.platform === "win32" ? "headroom.exe" : "headroom"), "")

    const r = buildReadiness({ cwd, home: cwd, probe, git: () => "abc123", now: () => "2026-07-04" })
    assert.equal(r.schemaVersion, 2)
    assert.equal(r.tools.fallow.status, "callable")
    assert.equal(r.tools.headroom.status, "callable_not_routed", "Headroom sem proxy roteado NUNCA é routed")
    assert.equal(r.guardrails.envFilesTouched, false)
    assert.equal(r.guardrails.projectScopedOnly, true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("buildReadiness: headroom vira 'routed' só quando o doctor confirma proxy+routed", async () => {
  const { buildReadiness } = await imp(readyMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    const hdir = path.join(cwd, ".gstack", "tools", "headroom-venv", process.platform === "win32" ? "Scripts" : "bin")
    await mkdir(hdir, { recursive: true })
    await writeFile(path.join(hdir, process.platform === "win32" ? "headroom.exe" : "headroom"), "")
    const probe = makeProbe({
      "headroom --version": { ok: true, code: 0, stdout: "headroom 0.28.0", stderr: "" },
      "headroom doctor": { ok: true, code: 0, stdout: "Proxy running on :7070; harness routed", stderr: "" },
    })
    const r = buildReadiness({ cwd, home: cwd, probe, git: () => "abc" })
    assert.equal(r.tools.headroom.status, "routed")
    assert.equal(r.tools.headroom.routed, true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("buildReadiness: graphify freshness fresh vs stale vs absent (built_at_commit x HEAD)", async () => {
  const { buildReadiness } = await imp(readyMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    const probe = makeProbe({ "graphify --version": { ok: true, code: 0, stdout: "graphify 0.8.0", stderr: "" } })
    // sem graph.json → absent
    let r = buildReadiness({ cwd, home: cwd, probe, git: () => "HEAD1" })
    assert.equal(r.tools.graphify.freshness.state, "absent")

    await mkdir(path.join(cwd, "graphify-out"), { recursive: true })
    await writeFile(path.join(cwd, "graphify-out", "graph.json"), JSON.stringify({ built_at_commit: "HEAD1", nodes: [] }))
    r = buildReadiness({ cwd, home: cwd, probe, git: () => "HEAD1" })
    assert.equal(r.tools.graphify.freshness.state, "fresh")

    r = buildReadiness({ cwd, home: cwd, probe, git: () => "HEAD2" })
    assert.equal(r.tools.graphify.freshness.state, "stale")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("buildReadiness: tool ausente → missing (sem arquivo, comando falha)", async () => {
  const { buildReadiness } = await imp(readyMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    const r = buildReadiness({ cwd, home: cwd, probe: makeProbe({}), git: () => null })
    assert.equal(r.tools.fallow.status, "missing")
    assert.equal(r.tools.headroom.status, "missing", "sem headroom.exe → missing")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("buildReadiness delta: graphify metrics (nós/arestas/comunidades/indexedCommit) do graph.json", async () => {
  const { buildReadiness } = await imp(readyMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    await mkdir(path.join(cwd, "graphify-out"), { recursive: true })
    const graph = {
      built_at_commit: "abc123",
      nodes: [{ id: 1, community: 0 }, { id: 2, community: 1 }, { id: 3, community: 1 }],
      links: [{ source: 1, target: 2 }, { source: 2, target: 3 }],
    }
    await writeFile(path.join(cwd, "graphify-out", "graph.json"), JSON.stringify(graph))
    const probe = makeProbe({ "graphify --version": { ok: true, code: 0, stdout: "graphify 0.8.30", stderr: "" } })
    const m = buildReadiness({ cwd, home: cwd, probe, git: () => "abc123" }).tools.graphify.metrics
    assert.deepEqual(m, { indexedCommit: "abc123", nodes: 3, edges: 2, communities: 2 })
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("buildReadiness delta: fallow auditSummary — unknown por default, parseado quando injetado", async () => {
  const { buildReadiness } = await imp(readyMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    const probe = makeProbe({ "npx fallow": { ok: true, code: 0, stdout: "fallow 2.104.0", stderr: "" } })
    // default: não roda audit (pesado) → verdict unknown com nota honesta
    const def = buildReadiness({ cwd, home: cwd, probe, git: () => "h" }).tools.fallow.auditSummary
    assert.equal(def.verdict, "unknown")
    assert.ok(def.note, "declara que o audit não foi executado")
    // injetado: parseia verdict + summary
    const fallowAudit = () => ({ ok: true, stdout: JSON.stringify({ verdict: "fail", summary: { dead_code_issues: 170, complexity_findings: 240, duplication_clone_groups: 9, max_cyclomatic: 6 } }) })
    const inj = buildReadiness({ cwd, home: cwd, probe, git: () => "h", fallowAudit }).tools.fallow.auditSummary
    assert.equal(inj.verdict, "fail")
    assert.equal(inj.deadCode, 170)
    assert.equal(inj.complexity, 240)
    assert.equal(inj.duplication, 9)
    assert.equal(inj.maxCyclomatic, 6)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("buildReadiness delta: context typed counts (bySource) via runFull injetado", async () => {
  const { buildReadiness } = await imp(readyMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    // DB precisa existir p/ o readiness tentar contar
    await mkdir(path.join(cwd, ".gstack", "context"), { recursive: true })
    await writeFile(path.join(cwd, ".gstack", "context", "context.db"), "")
    const statusJson = { documents: 68, chunks: 292, entities: 42, edges: 54, fts_enabled: true, by_source: { prd: 22, plans: 21, adr: 6, research: 2 } }
    const runFull = () => ({ ok: true, code: 0, stdout: JSON.stringify(statusJson), stderr: "" })
    const probe = makeProbe({ "python3 --version": { ok: true, code: 0, stdout: "Python 3.12", stderr: "" } })
    const ctx = buildReadiness({ cwd, home: cwd, probe, git: () => "h", runFull }).tools.gstackContext
    assert.equal(ctx.status, "callable")
    assert.equal(ctx.counts.documents, 68)
    assert.equal(ctx.counts.bySource.prd, 22)
    assert.equal(ctx.counts.bySource.plans, 21)
    assert.equal(ctx.counts.bySource.adr, 6)
    assert.equal(ctx.counts.bySource.research, 2)
    assert.equal(ctx.counts.bySource.docs, 0, "chave tipada ausente vira 0")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("buildReadiness delta: headroom routing por harness a partir do doctor", async () => {
  const { buildReadiness } = await imp(readyMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    const hdir = path.join(cwd, ".gstack", "tools", "headroom-venv", process.platform === "win32" ? "Scripts" : "bin")
    await mkdir(hdir, { recursive: true })
    await writeFile(path.join(hdir, process.platform === "win32" ? "headroom.exe" : "headroom"), "")
    const doctor = "Proxy running on :7070\nClaude: routed\nCodex: not routed\nOpenCode: not routed\nharness routed"
    const probe = makeProbe({
      "headroom --version": { ok: true, code: 0, stdout: "headroom 0.28.0", stderr: "" },
      "headroom doctor": { ok: true, code: 0, stdout: doctor, stderr: "" },
    })
    const hr = buildReadiness({ cwd, home: cwd, probe, git: () => "h" }).tools.headroom.routing
    assert.equal(hr.proxyRunning, true)
    assert.equal(hr.byHarness.claude, "routed")
    assert.equal(hr.byHarness.codex, "not_routed")
    assert.equal(hr.byHarness.opencode, "not_routed")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("tools readiness: default NÃO escreve; --write grava project-scoped; --json é puro", async () => {
  const { toolsCommand } = await imp(toolsMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ready-"))
  try {
    const probe = makeProbe({ "npx fallow": { ok: true, code: 0, stdout: "fallow 2", stderr: "" } })
    const opts = { cwd, home: cwd, probe, git: () => "h", now: () => "t" }

    // default: nada escrito
    await toolsCommand(["readiness"], opts)
    assert.equal(existsSync(path.join(cwd, ".gstack", "tool-readiness.json")), false, "sem --write, nada em disco")

    // --json puro (captura stdout)
    const orig = process.stdout.write.bind(process.stdout)
    let out = ""
    process.stdout.write = (s) => { out += s; return true }
    try { await toolsCommand(["readiness", "--json"], opts) } finally { process.stdout.write = orig }
    const parsed = JSON.parse(out) // lança se não for JSON puro
    assert.equal(parsed.schemaVersion, 2)
    assert.ok(!out.includes("["), "sem ANSI no --json")

    // --write grava o registry
    await toolsCommand(["readiness", "--write"], opts)
    const written = JSON.parse(await readFile(path.join(cwd, ".gstack", "tool-readiness.json"), "utf-8"))
    assert.equal(written.schemaVersion, 2)
    assert.equal(written.guardrails.envFilesTouched, false)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
