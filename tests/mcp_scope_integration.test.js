import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const readinessMod = path.join(repoRoot, "src", "tools", "readiness.js")
const doctorMod = path.join(repoRoot, "src", "harness", "opencode-doctor.js")
const scopeMod = path.join(repoRoot, "src", "mcp", "scope.js")

test("readiness: bloco mcp classifica runtime-injected após register", async () => {
  const { buildReadiness } = await import(`${pathToFileURL(readinessMod)}?t=${Date.now()}`)
  const { registerRuntimeMcp } = await import(`${pathToFileURL(scopeMod)}?t=${Date.now()}`)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-rdy-"))
  try {
    // probe/runFull injetados: readiness não spawna nada real
    const probe = () => ({ ok: false, code: null, stdout: "", stderr: "" })
    const before = buildReadiness({ cwd, home: cwd, probe, runFull: () => ({ ok: false, stdout: "" }), git: () => null })
    assert.equal(before.mcp.byScope.runtime_injected, 0, "sem runtime-injected inicialmente")
    assert.equal(before.mcp.hasRuntimeInjected, false)

    registerRuntimeMcp({ cwd, name: "context7", server: { command: "npx context7" } })
    const after = buildReadiness({ cwd, home: cwd, probe, runFull: () => ({ ok: false, stdout: "" }), git: () => null })
    assert.equal(after.mcp.byScope.runtime_injected, 1, "runtime-injected contabilizado no readiness")
    assert.equal(after.mcp.hasRuntimeInjected, true)
    assert.match(after.mcp.note, /opencode mcp list/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("doctor --opencode: categoria mcp diferencia global-ausente de runtime-injected", async () => {
  const { buildOpenCodeDoctorV2 } = await import(`${pathToFileURL(doctorMod)}?t=${Date.now()}`)
  const { registerRuntimeMcp } = await import(`${pathToFileURL(scopeMod)}?t=${Date.now()}`)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-doc-"))
  const home = await mkdtemp(path.join(tmpdir(), "gstack-home-"))
  try {
    const probe = () => null // CLI opencode ausente (não spawna)
    const none = buildOpenCodeDoctorV2({ home, cwd, probe })
    assert.equal(none.categories.mcp.status, "ok")
    assert.equal(none.categories.mcp.runtimeInjected.length, 0)
    assert.equal(none.categories.mcp.globalAbsentIsDistinct, true)
    assert.match(none.categories.mcp.note, /global ausente/i)

    registerRuntimeMcp({ cwd, name: "context7", server: {} })
    const withRuntime = buildOpenCodeDoctorV2({ home, cwd, probe })
    assert.deepEqual(withRuntime.categories.mcp.runtimeInjected, ["context7"])
    assert.match(withRuntime.categories.mcp.note, /não aparece em `opencode mcp list`|NÃO aparece/i)
  } finally { await rm(cwd, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }) }
})
