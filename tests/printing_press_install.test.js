import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const installModule = path.join(repoRoot, "src", "printing-press", "install.js")
const toolsModule = path.join(repoRoot, "src", "commands", "tools.js")

// exec mock. hasGo: go responde a --version. goInstallable: winget/brew/tarball ok.
function makeExec({ hasGo = true, goInstallable = true, installOk = true, binOnPath = true } = {}) {
  let goReady = hasGo
  return (file, args) => {
    const cmd = [file, ...args].join(" ")
    // toolchain Go (qualquer caminho candidato termina em go/go.exe)
    if (file === "go" || /[\\/]go(\.exe)?$/.test(file)) {
      if (goReady) return Buffer.from("go version go1.22")
      throw new Error("go not found")
    }
    // instaladores de Go
    if (file === "winget" || file === "brew" || file === "choco" || file === "tar") {
      if (goInstallable) { goReady = true; return Buffer.from("installed") }
      throw new Error("install go failed")
    }
    if (file === "curl") { if (goInstallable) return Buffer.from(""); throw new Error("download failed") }
    if (cmd.includes(" install ") || args.includes("install")) {
      if (installOk) return Buffer.from("ok")
      throw new Error("go install failed")
    }
    if (args.includes("uninstall")) return Buffer.from("removed")
    // verificacao do binario da tool
    if (args.includes("--version")) {
      if (binOnPath && file.includes("stripe")) return Buffer.from("stripe 1.0")
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

test("installTool: sem Go mas instalavel -> instala Go sob demanda e prossegue", async () => {
  const { installTool } = await import(`${pathToFileURL(installModule)}?t=${Date.now()}`)
  const r = installTool("stripe", { exec: makeExec({ hasGo: false, goInstallable: true }), platform: "darwin" })
  assert.equal(r.status, "installed", "Go instalado sob demanda, tool instalada")
})

test("installTool: sem Go e nao instalavel -> needs_go", async () => {
  const { installTool } = await import(`${pathToFileURL(installModule)}?t=${Date.now()}`)
  const r = installTool("stripe", { exec: makeExec({ hasGo: false, goInstallable: false }), platform: "darwin" })
  assert.equal(r.status, "needs_go")
})

test("ensureGo: presente -> present; ausente+instalavel -> installed; autoInstall:false -> absent", async () => {
  const { ensureGo } = await import(`${pathToFileURL(installModule)}?t=${Date.now()}`)
  assert.equal(ensureGo({ exec: makeExec({ hasGo: true }), platform: "darwin" }).status, "present")
  assert.equal(ensureGo({ exec: makeExec({ hasGo: false, goInstallable: true }), platform: "darwin" }).status, "installed")
  assert.equal(ensureGo({ exec: makeExec({ hasGo: false }), platform: "darwin", autoInstall: false }).status, "absent")
})

test("ensureGo Linux: baixa o tarball da arch certa; arch desconhecida nao auto-instala", async () => {
  const { ensureGo } = await import(`${pathToFileURL(installModule)}?t=${Date.now()}`)
  // HOME temporário GRAVÁVEL: installGoLinuxTarball faz mkdirSync(home/.local) real.
  // Um path fixo tipo "/home/u" falha por permissão no CI Linux (e cria lixo no Windows).
  const home = await mkdtemp(path.join(tmpdir(), "gstack-go-"))
  try {
    // arm64: deve tentar baixar e instalar
    let urlBaixada = ""
    const execArm = (file, args) => {
      if (/[\\/]go(\.exe)?$/.test(file) || file === "go") {
        if (urlBaixada) return Buffer.from("go1.22"); throw new Error("no go")
      }
      if (file === "curl") { urlBaixada = args[args.indexOf("-o") - 1] || args[2]; return Buffer.from("") }
      if (file === "tar") return Buffer.from("")
      throw new Error("unexpected " + file)
    }
    const rArm = ensureGo({ exec: execArm, platform: "linux", arch: "arm64", home })
    assert.match(urlBaixada, /linux-arm64\.tar\.gz/, "baixa o tarball arm64")
    assert.equal(rArm.status, "installed")

    // arch desconhecida (riscv64): nao auto-instala
    const rUnknown = ensureGo({ exec: makeExec({ hasGo: false }), platform: "linux", arch: "riscv64", home })
    assert.equal(rUnknown.status, "absent")
    assert.match(rUnknown.error, /nao suportada|manual/i)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
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

test("tools install migra registry antigo sem bloco printingPress", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-migrate-"))
  try {
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    // registry ANTIGO: sem printingPress (projeto criado antes da feature)
    await writeFile(path.join(tmp, ".gstack", "integrations.json"), JSON.stringify({ schemaVersion: 1 }))
    const { toolsCommand } = await import(`${pathToFileURL(toolsModule)}?t=${Date.now()}`)
    // nao deve explodir ao acessar reg.printingPress
    await toolsCommand(["install", "stripe"], { cwd: tmp, exec: makeExec({}) })
    const reg = JSON.parse(await readFile(path.join(tmp, ".gstack", "integrations.json"), "utf-8"))
    assert.ok(reg.printingPress, "bloco printingPress criado na migracao")
    assert.equal(reg.printingPress.installed[0].name, "stripe")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("tools uninstall em FALHA nao esquece do registry (marca uninstall_failed)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-uninst-fail-"))
  try {
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    await writeFile(path.join(tmp, ".gstack", "integrations.json"), JSON.stringify({
      schemaVersion: 1,
      printingPress: { enabled: true, installed: [{ name: "stripe", cli: "stripe-pp-cli", status: "installed" }], suggested: [], mcp: [] },
    }))
    const { toolsCommand } = await import(`${pathToFileURL(toolsModule)}?t=${Date.now()}`)
    // exec que faz o `uninstall` externo falhar
    const failExec = (file, args) => {
      if (args.includes("uninstall")) throw new Error("uninstall externo falhou")
      return Buffer.from("ok")
    }
    await toolsCommand(["uninstall", "stripe"], { cwd: tmp, exec: failExec })
    const reg = JSON.parse(await readFile(path.join(tmp, ".gstack", "integrations.json"), "utf-8"))
    assert.equal(reg.printingPress.installed.length, 1, "entrada NAO removida em falha")
    assert.equal(reg.printingPress.installed[0].status, "uninstall_failed")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
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
