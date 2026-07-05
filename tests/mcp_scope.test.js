import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "mcp", "scope.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("classifyScope: runtime_injected × project_local × global", async () => {
  const { classifyScope } = await imp()
  const cwd = "C:/proj/app"
  assert.equal(classifyScope("C:/proj/app/.gstack/mcp/runtime.json", { cwd }), "runtime_injected")
  assert.equal(classifyScope("C:/proj/app/.mcp.json", { cwd }), "project_local")
  assert.equal(classifyScope("C:/Users/x/.config/opencode/opencode.jsonc", { cwd }), "global")
  assert.equal(classifyScope("", { cwd }), "unknown")
})

test("isDestructive: deny-default para nomes destrutivos", async () => {
  const { isDestructive } = await imp()
  for (const n of ["rm-server", "file-delete", "drop-db", "shell-exec", "sudo-tool"]) {
    assert.equal(isDestructive(n), true, `${n} é destrutivo`)
  }
  for (const n of ["context7", "graph-reader", "search"]) {
    assert.equal(isDestructive(n), false, `${n} não é destrutivo`)
  }
})

test("registerRuntimeMcp: escreve SÓ .gstack/mcp/runtime.json (nada global), reversível", async () => {
  const { registerRuntimeMcp, unregisterRuntimeMcp, readRuntimeMcp } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mcp-"))
  try {
    const r = registerRuntimeMcp({ cwd, name: "context7", server: { command: "npx context7" } })
    assert.equal(r.registered, true)
    assert.equal(r.scope, "runtime_injected")
    assert.match(r.file.replace(/\\/g, "/"), /\.gstack\/mcp\/runtime\.json$/)
    assert.ok(existsSync(r.file), "manifest project-scoped criado")
    // nada global: o único arquivo escrito está DENTRO do projeto (nunca ~/.mcp.json)
    assert.ok(path.resolve(r.file).startsWith(path.resolve(cwd)), "escrita fica dentro do projeto")
    const manifest = JSON.parse(await readFile(r.file, "utf-8"))
    assert.equal(manifest.servers.context7.scope, "runtime_injected")
    // aparece no reader
    assert.deepEqual(readRuntimeMcp({ cwd }).servers.map((s) => s.name), ["context7"])
    // reversível
    assert.equal(unregisterRuntimeMcp({ cwd, name: "context7" }).unregistered, true)
    assert.deepEqual(readRuntimeMcp({ cwd }).servers, [])
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("registerRuntimeMcp: recusa destrutivo por padrão; --allow libera", async () => {
  const { registerRuntimeMcp } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mcp-"))
  try {
    const denied = registerRuntimeMcp({ cwd, name: "rm-rf-tool" })
    assert.equal(denied.refused, true)
    assert.match(denied.reason, /destrutivo|negado/i)
    assert.equal(existsSync(path.join(cwd, ".gstack", "mcp", "runtime.json")), false, "recusa não escreve nada")
    const allowed = registerRuntimeMcp({ cwd, name: "rm-rf-tool", allowDestructive: true })
    assert.equal(allowed.registered, true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("summarizeScopes: conta por escopo e sinaliza runtime-injected", async () => {
  const { summarizeScopes } = await imp()
  const cwd = "C:/proj"
  const servers = [
    { source: "C:/proj/.gstack/mcp/runtime.json" },
    { source: "C:/proj/.mcp.json" },
    { source: "C:/Users/x/.claude.json" },
  ]
  const s = summarizeScopes(servers, { cwd })
  assert.equal(s.byScope.runtime_injected, 1)
  assert.equal(s.byScope.project_local, 1)
  assert.equal(s.byScope.global, 1)
  assert.equal(s.hasRuntimeInjected, true)
  assert.equal(s.total, 3)
})
