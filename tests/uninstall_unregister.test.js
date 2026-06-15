import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Regressao: o uninstall deve remover os registros de hooks gstack do
 * settings.json (Claude) e hooks.json (Cursor) — senao o harness aponta para
 * .py deletados e falha em todo turno. Como uninstall.js usa homedir() no
 * nivel de modulo, testamos a logica de filtragem com um HOME temporario via
 * dynamic import apos setar a env (homedir respeita USERPROFILE/HOME).
 */

test("unregisterHooks remove entradas gstack preservando hooks do usuario", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-unreg-"))
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  try {
    process.env.HOME = tmp
    process.env.USERPROFILE = tmp

    await mkdir(path.join(tmp, ".claude"), { recursive: true })
    await mkdir(path.join(tmp, ".cursor"), { recursive: true })

    // settings.json com 1 hook do usuario + 1 hook gstack
    await writeFile(path.join(tmp, ".claude", "settings.json"), JSON.stringify({
      model: "opus",
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "meu-hook.sh" }] },
          { hooks: [{ type: "command", command: 'python "/home/u/.gstack/hooks/stop.py"' }] },
        ],
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: 'python "/home/u/.gstack/hooks/pre_tool_use_security.py"' }] },
        ],
      },
    }))

    await writeFile(path.join(tmp, ".cursor", "hooks.json"), JSON.stringify({
      version: 1,
      hooks: {
        stop: [
          { command: "meu-audit.sh" },
          { command: 'python "/home/u/.gstack/hooks/stop.py"' },
        ],
      },
    }))

    // Import com HOME setado — uninstall.js le homedir() no load
    const mod = await import(`${pathToFileURL(path.join(process.cwd(), "src", "installer", "uninstall.js"))}?t=${Date.now()}`)
    // unregisterHooks nao e exportado; exercemos via uninstall() em modo nao-TTY exige --yes.
    // Em vez disso, validamos o efeito chamando uninstall com --yes num HOME isolado.
    const report = await mod.uninstall(["--yes"])

    const settings = JSON.parse(await readFile(path.join(tmp, ".claude", "settings.json"), "utf-8"))
    // hook do usuario preservado
    const stopCmds = (settings.hooks.Stop || []).flatMap((e) => e.hooks.map((h) => h.command))
    assert.ok(stopCmds.includes("meu-hook.sh"), "hook do usuario preservado")
    assert.ok(!stopCmds.some((c) => c.includes("stop.py")), "hook gstack removido")
    // PreToolUse so tinha gstack -> evento removido
    assert.equal(settings.hooks.PreToolUse, undefined, "evento so-gstack removido")

    const cursor = JSON.parse(await readFile(path.join(tmp, ".cursor", "hooks.json"), "utf-8"))
    const cursorStop = (cursor.hooks.stop || []).map((e) => e.command)
    assert.ok(cursorStop.includes("meu-audit.sh"), "hook cursor do usuario preservado")
    assert.ok(!cursorStop.some((c) => c.includes("stop.py")), "hook gstack removido do cursor")

    assert.ok(Array.isArray(report.removed))
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile
    await rm(tmp, { recursive: true, force: true })
  }
})
