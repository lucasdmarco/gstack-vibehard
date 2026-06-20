import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const bin = path.join(repoRoot, "src", "index.js")
const ESC = String.fromCharCode(27) // \x1b — início de toda sequência ANSI

function run(args, env = {}) {
  try {
    const out = execFileSync("node", [bin, ...args], { encoding: "utf-8", env: { ...process.env, ...env }, stdio: "pipe" })
    return { code: 0, out }
  } catch (e) {
    return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + (e.stderr || "") }
  }
}

test("no-args: exit 0, sugere `start`, NÃO instala nem escreve no HOME", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-cli-"))
  try {
    const before = readdirSync(home).length
    const r = run([], { HOME: home, USERPROFILE: home })
    assert.equal(r.code, 0)
    assert.match(r.out, /gstack_vibehard start/)
    assert.doesNotMatch(r.out, /Instalando pacote|Impacto desta inst/)
    assert.equal(readdirSync(home).length, before, "no-args não escreve no HOME")
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("--help e -h: exit 0, sem 'Comando desconhecido'", () => {
  for (const flag of ["--help", "-h"]) {
    const r = run([flag])
    assert.equal(r.code, 0, flag)
    assert.doesNotMatch(r.out, /Comando desconhecido/)
    assert.match(r.out, /Comandos:/)
  }
})

test("help: banner aparece no máximo uma vez (sem duplicar)", () => {
  const r = run(["help"])
  const banners = (r.out.match(/GStack VibeHard Installer/g) || []).length
  assert.ok(banners <= 1, `banner duplicado (${banners})`)
})

test("help advanced: lista comandos avançados", () => {
  const r = run(["help", "advanced"])
  assert.equal(r.code, 0)
  assert.match(r.out, /delegate|workflow|publish-guard/)
})

test("install --help: mostra ajuda e NÃO entra no instalador", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-cli-"))
  try {
    const before = readdirSync(home).length
    const r = run(["install", "--help"], { HOME: home, USERPROFILE: home })
    assert.equal(r.code, 0)
    assert.doesNotMatch(r.out, /Instalando pacote|Impacto desta inst|Harnesses detectados/)
    assert.match(r.out, /install/)
    assert.equal(readdirSync(home).length, before)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("create --help: ajuda do subcomando, exit 0, não executa", () => {
  const r = run(["create", "--help"])
  assert.equal(r.code, 0)
  assert.match(r.out, /create/)
})

test("--no-color: sem sequências ANSI", () => {
  const r = run(["help", "--no-color"])
  assert.ok(!r.out.includes(ESC), "saída não deve conter escape ANSI")
})
