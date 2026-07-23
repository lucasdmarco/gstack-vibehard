import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..", "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.3 — config-sacred real: um "home" simulado com config global
 * plausível (~/.claude/settings.json com hooks/MCP do usuário) NUNCA é tocado
 * quando `applyDesignHookProjections` roda contra um PROJETO separado.
 * `design-hooks.js` nunca importa `homedir()` — a garantia é estrutural, mas
 * este E2E prova o comportamento fim-a-fim, não só a ausência do import.
 */

test("E2E: home simulado com config global do usuário fica byte-idêntico após instalar hooks no projeto", async () => {
  const { applyDesignHookProjections } = await imp("src/harness/design-hooks.js")
  const fakeHome = await mkdtemp(path.join(tmpdir(), "gstack-fakehome-"))
  const project = await mkdtemp(path.join(tmpdir(), "gstack-fakeproject-"))
  try {
    await mkdir(path.join(fakeHome, ".claude"), { recursive: true })
    const globalSettings = JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "some-users-global-hook.sh" }] }] },
      mcpServers: { userThing: { command: "npx", args: ["-y", "user-mcp"] } },
    }, null, 2)
    await writeFile(path.join(fakeHome, ".claude", "settings.json"), globalSettings)
    await writeFile(path.join(fakeHome, "AGENTS.md"), "# Global AGENTS.md do usuario\n")

    const result = applyDesignHookProjections(project)
    assert.equal(result.ok, true)

    const afterGlobalSettings = await readFile(path.join(fakeHome, ".claude", "settings.json"), "utf-8")
    const afterGlobalAgents = await readFile(path.join(fakeHome, "AGENTS.md"), "utf-8")
    assert.equal(afterGlobalSettings, globalSettings, "config GLOBAL do usuário fica byte-idêntica")
    assert.equal(afterGlobalAgents, "# Global AGENTS.md do usuario\n", "AGENTS.md global fica byte-idêntico")

    const projectSettings = await readFile(path.join(project, ".claude", "settings.json"), "utf-8")
    assert.match(projectSettings, /visual detect/, "o projeto, sim, recebe a projeção")
  } finally {
    await rm(fakeHome, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  }
})
