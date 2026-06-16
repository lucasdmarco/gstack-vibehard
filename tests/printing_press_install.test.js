import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const installModule = path.join(repoRoot, "src", "printing-press", "install.js")
const toolsModule = path.join(repoRoot, "src", "commands", "tools.js")

// exec mock: 'go --version' ok; 'npx ... install' ok; binario verificavel se onPath inclui o slug
function makeExec({ hasGo = true, installOk = true, binOnPath = true } = {}) {
  return (file, args) => {
    const cmd = [file, ...args].join(" ")
    if (file === "go") {
      if (hasGo) return Buffer.from("go version go1.22")
      throw new Error("go not found")
    }
    if (cmd.includes("install")) {
      if (installOk) return Buffer.from("ok")
      throw new Error("go install failed")
    }
    if (cmd.includes("uninstall")) return Buffer.from("removed")
    // verificacao do binario (findWorkingBinary chama <bin> --version)
    if (args.includes("--version")) {
      if (binOnPath && (file.includes("stripe"))) return Buffer.from("stripe 1.0")
      throw new Error("not found")
    }
    throw new Error("unexpected: " + cmd)
  }
}

test("installTool: sucesso quando Go presente e binario verificavel", async () => {
  const { installTool } = await import(`${pathToFileURL(installModule)}?t=${Date.now()}`)
  const r = installTool("stripe", { exec: makeExec({}) })
  assert.equal(r.status, "installed")
  assert.ok(r.cli.includes("stripe"))
  assert.equal(r.provenance, ".printing-press.json")
})

test("installTool: sem Go -> needs_go, nao instala", async () => {
  const { installTool } = await import(`${pathToFileURL(installModule)}?t=${Date.now()}`)
  const r = installTool("stripe", { exec: makeExec({ hasGo: false }) })
  assert.equal(r.status, "needs_go")
})

test("installTool: instala mas binario nao encontrado -> install_unverified", async () => {
  const { installTool } = await import(`${pathToFileURL(installModule)}?t=${Date.now()}`)
  const r = installTool("stripe", { exec: makeExec({ binOnPath: false }) })
  assert.equal(r.status, "install_unverified")
})

test("installTool: slug invalido rejeitado", async () => {
  const { installTool } = await import(`${pathToFileURL(installModule)}?t=${Date.now()}`)
  assert.equal(installTool("stripe; rm -rf /", { exec: makeExec({}) }).status, "invalid_slug")
})

test("tools install/uninstall atualiza registry (project-scoped)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-inst-"))
  try {
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    await writeFile(path.join(tmp, ".gstack", "integrations.json"), JSON.stringify({
      schemaVersion: 1, printingPress: { enabled: false, installed: [], suggested: ["stripe"] },
    }))
    const { toolsCommand } = await import(`${pathToFileURL(toolsModule)}?t=${Date.now()}`)

    await toolsCommand(["install", "stripe"], { cwd: tmp, exec: makeExec({}) })
    let reg = JSON.parse(await readFile(path.join(tmp, ".gstack", "integrations.json"), "utf-8"))
    assert.equal(reg.printingPress.enabled, true)
    assert.equal(reg.printingPress.installed.length, 1)
    assert.equal(reg.printingPress.installed[0].name, "stripe")

    await toolsCommand(["uninstall", "stripe"], { cwd: tmp, exec: makeExec({}) })
    reg = JSON.parse(await readFile(path.join(tmp, ".gstack", "integrations.json"), "utf-8"))
    assert.equal(reg.printingPress.installed.length, 0, "entrada removida do registry")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
