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
