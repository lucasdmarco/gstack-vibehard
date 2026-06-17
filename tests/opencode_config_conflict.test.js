import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "harness", "opencode-config.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

async function withHome(files, fn) {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-occ-"))
  const dir = path.join(home, ".config", "opencode")
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content)
  try { return await fn(home) } finally { await rm(home, { recursive: true, force: true }) }
}

test("inspect: só opencode.json → json_merge", async () => {
  const { inspectOpenCodeConfig, shouldWriteOpenCodeJson, OPENCODE_STRATEGIES } = await imp()
  await withHome({ "opencode.json": "{}" }, (home) => {
    const r = inspectOpenCodeConfig(home)
    assert.equal(r.preferredStrategy, OPENCODE_STRATEGIES.JSON_MERGE)
    assert.equal(shouldWriteOpenCodeJson(r), true)
    assert.equal(r.hasConflict, false)
  })
})

test("inspect: só opencode.jsonc → directory_only, NUNCA escreve json", async () => {
  const { inspectOpenCodeConfig, shouldWriteOpenCodeJson, OPENCODE_STRATEGIES } = await imp()
  await withHome({ "opencode.jsonc": "{ /* oauth */ }" }, (home) => {
    const r = inspectOpenCodeConfig(home)
    assert.equal(r.preferredStrategy, OPENCODE_STRATEGIES.DIRECTORY_ONLY)
    assert.equal(shouldWriteOpenCodeJson(r), false)
    assert.ok(r.warnings.length > 0)
  })
})

test("inspect: ambos → conflict_warn_only, não escreve nada e alerta", async () => {
  const { inspectOpenCodeConfig, shouldWriteOpenCodeJson, OPENCODE_STRATEGIES } = await imp()
  await withHome({ "opencode.json": "{}", "opencode.jsonc": "{}" }, (home) => {
    const r = inspectOpenCodeConfig(home)
    assert.equal(r.preferredStrategy, OPENCODE_STRATEGIES.CONFLICT_WARN_ONLY)
    assert.equal(r.hasConflict, true)
    assert.equal(shouldWriteOpenCodeJson(r), false)
    assert.ok(r.warnings.some((w) => /gstack-bak/.test(w)), "sugere backup manual, não delete")
  })
})

test("inspect: nenhum config → directory_only (não cria config concorrente)", async () => {
  const { inspectOpenCodeConfig, shouldWriteOpenCodeJson, OPENCODE_STRATEGIES } = await imp()
  await withHome({}, (home) => {
    const r = inspectOpenCodeConfig(home)
    assert.equal(r.preferredStrategy, OPENCODE_STRATEGIES.DIRECTORY_ONLY)
    assert.equal(shouldWriteOpenCodeJson(r), false)
  })
})
