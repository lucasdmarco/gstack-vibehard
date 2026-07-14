#!/usr/bin/env node
/**
 * Golden Harness (PRD42 S42.0E). Compara a saída REAL de comandos determinísticos do CLI
 * contra fixtures versionados (`tests/golden/<name>.stdout.txt`), normalizando o que é
 * ambiental (dir temp, HOME, tmp, versão, separador de path) para ser estável entre
 * máquinas/plataformas. Objetivo: travar contratos de saída como regressão byte-a-byte —
 * em especial a Verdade de Capacidade do S42.0A (Lite NÃO materializa Casdoor/Headroom/
 * OpenHands; Full provisiona).
 *
 * Regra dura (PLANSPRINTSPRD42): `--update` regenera os fixtures MAS RECUSA árvore suja
 * (mudanças fora de tests/golden/) — golden nunca é "atualizado só p/ passar CI" junto de
 * código não revisado. `--fixtures <dir>` aponta p/ outro diretório (usado no controle
 * negativo do próprio harness).
 */
import { spawnSync, execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const CLI = join(ROOT, "src", "index.js")
const DEFAULT_FIXTURES = join(ROOT, "tests", "golden")

/** Casos determinísticos. `create --dry-run --json` não escreve nada e depende só do modo. */
export const GOLDEN_CASES = Object.freeze([
  { name: "create-lite-dryrun", argv: ["create", "goldenapp", "--dry-run", "--json"], cwdTemp: true, expectExit: 0 },
  { name: "create-full-dryrun", argv: ["create", "goldenfull", "--full", "--dry-run", "--json"], cwdTemp: true, expectExit: 0 },
])

/** Substitui prefixos ambientais por marcadores estáveis e normaliza separador de path. */
export function normalize(raw, { cwd, version }) {
  let s = String(raw).replace(/\r\n/g, "\n")
  const subs = [
    [cwd, "<CWD>"],
    [tmpdir(), "<TMP>"],
    [homedir(), "<HOME>"],
  ]
  for (const [from, to] of subs) {
    if (!from) continue
    s = s.split(from).join(to)
    s = s.split(from.replace(/\\/g, "\\\\")).join(to) // caminhos escapados em JSON
  }
  return s.replace(/\\\\/g, "/").replace(/\\/g, "/").trimEnd() + "\n"
}

function pkgVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version
}

const caseCwd = (caseDef) => (caseDef.cwdTemp ? mkdtempSync(join(tmpdir(), "gstack-golden-")) : ROOT)
function cleanupCwd(caseDef, cwd) {
  if (caseDef.cwdTemp) { try { rmSync(cwd, { recursive: true, force: true }) } catch { /* best-effort */ } }
}

/** Roda UM caso e devolve stdout normalizado + exit real (sem tocar em disco do projeto). */
export function runCase(caseDef, { version } = {}) {
  const cwd = caseCwd(caseDef)
  const v = version || pkgVersion()
  try {
    const res = spawnSync(process.execPath, [CLI, ...caseDef.argv], { cwd, encoding: "utf8", timeout: 60000 })
    return { exit: res.status, stdout: normalize(res.stdout || "", { cwd, version: v }), stderr: res.stderr || "" }
  } finally {
    cleanupCwd(caseDef, cwd)
  }
}

const fixturePath = (dir, name) => join(dir, `${name}.stdout.txt`)

/** Comparação pura (testável): devolve {ok, reason?} p/ um caso já executado. */
export function compareCase(caseDef, result, fixturesDir) {
  if (result.exit !== caseDef.expectExit) return { ok: false, reason: `exit ${result.exit} != esperado ${caseDef.expectExit}` }
  const fp = fixturePath(fixturesDir, caseDef.name)
  if (!existsSync(fp)) return { ok: false, reason: `fixture ausente: ${fp} (rode --update)` }
  const expected = readFileSync(fp, "utf8").replace(/\r\n/g, "\n")
  if (expected !== result.stdout) return { ok: false, reason: "drift de stdout vs golden" }
  return { ok: true }
}

/** Árvore suja = qualquer mudança FORA do diretório de fixtures. Puro/testável. */
export function treeIsDirtyOutside(statusLines, fixturesRel) {
  const norm = fixturesRel.replace(/\\/g, "/").replace(/\/$/, "")
  return statusLines
    .map((l) => l.slice(3).trim().replace(/\\/g, "/"))
    .filter(Boolean)
    .some((p) => !p.startsWith(norm + "/") && p !== norm)
}

function refuseIfDirty(fixturesDir) {
  let out = ""
  try { out = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }) }
  catch { return } // fora de git: não bloqueia (o gate de CI cobre)
  const fixturesRel = fixturesDir.startsWith(ROOT) ? fixturesDir.slice(ROOT.length + 1) : fixturesDir
  if (treeIsDirtyOutside(out.split("\n"), fixturesRel)) {
    console.error("golden --update RECUSADO: árvore de trabalho suja fora de", fixturesRel)
    console.error("  regenere os fixtures em um commit isolado e revisável.")
    process.exit(2)
  }
}

function parseFixturesDir() {
  const fi = process.argv.indexOf("--fixtures")
  return fi >= 0 ? resolve(process.argv[fi + 1]) : DEFAULT_FIXTURES
}

function updateAll(fixturesDir, version) {
  refuseIfDirty(fixturesDir)
  mkdirSync(fixturesDir, { recursive: true })
  for (const c of GOLDEN_CASES) {
    writeFileSync(fixturePath(fixturesDir, c.name), runCase(c, { version }).stdout)
    console.log(`golden: atualizado ${c.name}`)
  }
  console.log("golden: fixtures regenerados.")
}

function compareAll(fixturesDir, version) {
  let failures = 0
  for (const c of GOLDEN_CASES) {
    const cmp = compareCase(c, runCase(c, { version }), fixturesDir)
    if (cmp.ok) console.log(`golden PASS ${c.name}`)
    else { failures += 1; console.error(`golden FAIL ${c.name}: ${cmp.reason}`) }
  }
  return failures
}

function main() {
  const version = pkgVersion()
  const fixturesDir = parseFixturesDir()
  if (process.argv.includes("--update")) { updateAll(fixturesDir, version); return }
  const failures = compareAll(fixturesDir, version)
  if (failures > 0) { console.error(`golden: ${failures} caso(s) com drift.`); process.exit(1) }
  console.log(`golden: ${GOLDEN_CASES.length} caso(s) OK.`)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) main()
