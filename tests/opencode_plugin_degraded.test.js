import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "plugins", "opencode", "gstack-session.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("resolveStopPy: null (degraded) quando não há stop.py em ~/.gstack/hooks nem ~/.codex/hooks", async () => {
  const { resolveStopPy } = await imp()
  const home = await mkdtemp(path.join(tmpdir(), "gstack-plg-"))
  try {
    assert.equal(resolveStopPy({ home, existsSync, join: path.join }), null, "sem stop.py → degraded")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("resolveStopPy: prefere ~/.gstack/hooks/stop.py e cai para ~/.codex/hooks", async () => {
  const { resolveStopPy } = await imp()
  const home = await mkdtemp(path.join(tmpdir(), "gstack-plg-"))
  try {
    // só codex tem stop.py → usa codex
    await mkdir(path.join(home, ".codex", "hooks"), { recursive: true })
    await writeFile(path.join(home, ".codex", "hooks", "stop.py"), "# stop")
    assert.equal(
      resolveStopPy({ home, existsSync, join: path.join }),
      path.join(home, ".codex", "hooks", "stop.py"),
      "cai para ~/.codex/hooks",
    )
    // agora .gstack passa a existir → tem prioridade
    await mkdir(path.join(home, ".gstack", "hooks"), { recursive: true })
    await writeFile(path.join(home, ".gstack", "hooks", "stop.py"), "# stop")
    assert.equal(
      resolveStopPy({ home, existsSync, join: path.join }),
      path.join(home, ".gstack", "hooks", "stop.py"),
      "prefere ~/.gstack/hooks",
    )
  } finally { await rm(home, { recursive: true, force: true }) }
})
