import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// S0 (PRD36 36.7): os setup-*.ps1 sao o caminho REAL de onboarding no Windows e
// precisam rodar em Windows PowerShell 5.1 — a versao que TODA maquina Windows tem.
// Bugs de campo cobertos aqui: `||` (PS7-only), unicode em arquivo sem BOM (lido
// como ANSI, `✓` vira smart-quote e quebra o parse), here-string interpolado
// corrompendo o run.ps1 gerado, e `= true` sem `$` (falso-verde: exit 0 sem artefato).

const repoRoot = path.resolve(import.meta.dirname, "..")
const scriptsDir = path.join(repoRoot, "scripts", "scripts")
const setupScripts = readdirSync(scriptsDir).filter((f) => /^setup-.*\.ps1$/.test(f)).sort()
const readScript = (f) => readFileSync(path.join(scriptsDir, f), "utf8")
const isWin = process.platform === "win32"

test("setup-*.ps1: os 5 scripts de onboarding existem", () => {
  assert.deepEqual(setupScripts, [
    "setup-context7.ps1",
    "setup-gbrain.ps1",
    "setup-graphify.ps1",
    "setup-gstack.ps1",
    "setup-superpowers.ps1",
  ])
})

test("setup-*.ps1: 100% ASCII (sem BOM, PS 5.1 le como ANSI e unicode corrompe o parse)", () => {
  for (const f of setupScripts) {
    const text = readScript(f)
    const bad = [...text].filter((ch) => ch.codePointAt(0) > 0x7e)
    assert.equal(bad.length, 0, `${f} tem chars nao-ASCII: ${[...new Set(bad)].join(" ")}`)
  }
})

test("setup-*.ps1: sem sintaxe PowerShell 7+ (||, )&&, ??, ternario encadeado)", () => {
  for (const f of setupScripts) {
    const text = readScript(f)
    assert.ok(!/\|\|/.test(text), `${f} usa || (PS7-only; quebra no 5.1)`)
    assert.ok(!/\)\s*&&/.test(text), `${f} usa )&& (PS7-only; quebra no 5.1)`)
    assert.ok(!/\?\?/.test(text), `${f} usa ?? (PS7-only; quebra no 5.1)`)
  }
})

test("setup-*.ps1: booleanos PowerShell com $ (= true vira comando inexistente e o artefato nao e escrito)", () => {
  for (const f of setupScripts) {
    const text = readScript(f)
    assert.ok(!/=\s+(true|false)\s*$/m.test(text), `${f} tem '= true/false' sem $`)
  }
})

test("setup-superpowers.ps1: here-strings LITERAIS (@'...'@) — interpolacao corrompia o run.ps1 gerado", () => {
  const text = readScript("setup-superpowers.ps1")
  assert.ok(!text.includes('@"'), "here-string interpolado geraria run.ps1 com $Command expandido para vazio")
  assert.ok(text.includes("@'"), "gera run.ps1 via here-string literal")
})

test("setup-*.ps1 executam no Windows PowerShell 5.1: exit 0 + TODOS os artefatos escritos", { skip: !isWin }, async () => {
  const proj = await mkdtemp(path.join(tmpdir(), "gstack-s0-setup-"))
  const runPs = (args) =>
    spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { encoding: "utf8", timeout: 60000 })
  try {
    for (const f of setupScripts) {
      const args = ["-File", path.join(scriptsDir, f), "-ProjectDir", proj]
      if (f === "setup-gstack.ps1") args.push("-Variant", "express")
      const res = runPs(args)
      assert.equal(res.status, 0, `${f} exit=${res.status}\n${res.stderr}`)
    }

    // Ferramenta so e "instalada" com ARTEFATO presente (licao do transcript de campo)
    const artifacts = [
      [".gstack", "config.json"],
      [".gbrain", "context.json"],
      [".gbrain", "README.md"],
      [".context7", "stack.json"],
      [".context7", "AGENTS.md"],
      ["scripts", "run.ps1"],
      ["scripts", "seed.ps1"],
      [".graphify", "deps.json"],
      [".graphify", "index.html"],
    ]
    for (const parts of artifacts) {
      const p = path.join(proj, ...parts)
      assert.ok(existsSync(p), `artefato ausente: ${parts.join("/")}`)
    }

    const config = JSON.parse(readFileSync(path.join(proj, ".gstack", "config.json"), "utf8"))
    assert.equal(config.variant, "express")
    assert.equal(config.api_dir, "apps/api")
    assert.equal(config.db_package, "packages/db")

    const stack = JSON.parse(readFileSync(path.join(proj, ".context7", "stack.json"), "utf8"))
    assert.equal(stack.tools.typescript, true, "typescript deve ser booleano real no stack.json")

    // run.ps1 gerado nao pode sair corrompido: $Command intacto e executavel
    const runScript = readFileSync(path.join(proj, "scripts", "run.ps1"), "utf8")
    assert.ok(runScript.includes("[string]$Command"), "run.ps1 gerado perdeu $Command (interpolacao)")
    const help = runPs(["-File", path.join(proj, "scripts", "run.ps1"), "help"])
    assert.equal(help.status, 0, `run.ps1 help exit=${help.status}\n${help.stderr}`)
    assert.match(help.stdout, /Superpowers/)
  } finally {
    await rm(proj, { recursive: true, force: true })
  }
})
