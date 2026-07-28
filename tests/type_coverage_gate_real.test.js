import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")

/**
 * PRD51 S51.6.8 — controle negativo REAL do claim `type-coverage`.
 *
 * Achado: `tests/b3_typecheck.test.js` só confirmava PRESENÇA de arquivos/
 * chaves de script (.d.ts, jsconfig.json, `coverage:ci` no package.json) —
 * nunca provava que o gate de cobertura REALMENTE FALHA quando a cobertura
 * é baixa. Alguém podia enfraquecer os thresholds (`--lines=0`) e esse
 * teste continuaria passando. Este teste roda o `c8` real (mesmo binário
 * usado por `npm run coverage:ci`) contra um fixture com cobertura baixa
 * DE PROPÓSITO, provando os dois lados: falha quando o threshold não é
 * atingido, passa quando é.
 */

// npm.cmd/c8.cmd não spawnam com shell:false no Windows — mesmo padrão de
// test-pack.mjs/test-e2e-lifecycle.mjs/governance_sbom_real.test.js.
const isWin = process.platform === "win32"
const c8Bin = path.join(repoRoot, "node_modules", ".bin", isWin ? "c8.cmd" : "c8")

function buildFixture(tmp) {
  const srcDir = path.join(tmp, "src")
  mkdirSync(srcDir, { recursive: true })
  // metade do branch NUNCA é exercitada pelo teste abaixo -> cobertura real e baixa.
  writeFileSync(path.join(srcDir, "lowcov.mjs"), [
    "export function maybe(x) {",
    "  if (x > 0) return \"positivo\"",
    "  return \"nao-positivo\"",
    "}",
  ].join("\n"))
  writeFileSync(path.join(tmp, "run.mjs"), [
    "import assert from \"node:assert/strict\"",
    "import { maybe } from \"./src/lowcov.mjs\"",
    "assert.equal(maybe(1), \"positivo\")",
  ].join("\n"))
}

function runC8(tmp, extraArgs) {
  const args = ["--include=src", "--check-coverage", ...extraArgs, "node", "run.mjs"]
  return isWin
    ? execFileSync("cmd.exe", ["/c", c8Bin, ...args], { cwd: tmp, encoding: "utf-8", timeout: 30000 })
    : execFileSync(c8Bin, args, { cwd: tmp, encoding: "utf-8", timeout: 30000 })
}

test("CONTROLE NEGATIVO: c8 --check-coverage FALHA de verdade (exit != 0) quando o threshold não é atingido", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "gstack-c8-neg-"))
  try {
    buildFixture(tmp)
    let threw = false
    let output = ""
    try {
      output = runC8(tmp, ["--lines=100", "--functions=100", "--branches=100"])
    } catch (e) {
      threw = true
      output = String(e.stdout || "") + String(e.stderr || "")
    }
    assert.ok(threw, "c8 deveria falhar (exit != 0) com branch não coberta e threshold 100%")
    assert.match(output, /ERROR|not met/i, "c8 reporta o motivo real da falha, não silencia")
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test("c8 --check-coverage PASSA quando o threshold é atingível pela cobertura real", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "gstack-c8-pos-"))
  try {
    buildFixture(tmp)
    // threshold baixo o bastante pra cobertura real (só o branch "positivo" é exercitado).
    const out = runC8(tmp, ["--lines=1", "--functions=1", "--branches=1"])
    assert.match(out, /%/, "c8 roda e reporta um número de cobertura real")
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test("npm run coverage:ci real: thresholds declarados no script batem com o que roda de verdade (nunca enfraquecidos silenciosamente)", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
  const script = pkg.scripts["coverage:ci"]
  assert.match(script, /--lines=70/, "threshold de lines não foi enfraquecido")
  assert.match(script, /--functions=72/, "threshold de functions não foi enfraquecido")
  assert.match(script, /--branches=65/, "threshold de branches não foi enfraquecido")
})
