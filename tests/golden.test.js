import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { normalize, treeIsDirtyOutside, compareCase, GOLDEN_CASES } from "../scripts/golden.mjs"

// PRD42 S42.0E — o Golden Harness trava contratos de saída determinísticos como regressão
// byte-a-byte (em especial a Verdade de Capacidade do S42.0A). Os testes provam: (1) os
// fixtures versionados batem HOJE; (2) o harness PEGA drift (controle negativo real); (3)
// a normalização é estável entre máquinas; (4) --update recusa árvore suja.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const GOLDEN = join(ROOT, "scripts", "golden.mjs")
const FIXTURES = join(ROOT, "tests", "golden")

test("golden: fixtures versionados batem com a saída real (exit 0)", () => {
  const res = spawnSync(process.execPath, [GOLDEN, "--fixtures", FIXTURES], { cwd: ROOT, encoding: "utf8", timeout: 120000 })
  assert.equal(res.status, 0, `golden reportou drift:\n${res.stdout}\n${res.stderr}`)
})

test("CONTROLE NEGATIVO: fixture corrompido => golden PEGA o drift (exit 1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "golden-neg-"))
  try {
    cpSync(FIXTURES, dir, { recursive: true })
    const fp = join(dir, `${GOLDEN_CASES[0].name}.stdout.txt`)
    writeFileSync(fp, readFileSync(fp, "utf8") + '\n{"tampered":true}\n')
    const res = spawnSync(process.execPath, [GOLDEN, "--fixtures", dir], { cwd: ROOT, encoding: "utf8", timeout: 120000 })
    assert.equal(res.status, 1, "golden deveria falhar com fixture adulterado")
    assert.match(res.stderr + res.stdout, /drift/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("normalize: prefixos ambientais viram marcadores estáveis + separador unificado", () => {
  const raw = 'dir="C:\\\\Users\\\\x\\\\AppData\\\\Local\\\\Temp\\\\p"'
  const out = normalize(raw, { cwd: "C:\\Users\\x\\AppData\\Local\\Temp", version: "9.9.9" })
  assert.match(out, /<CWD>/)
  assert.ok(!out.includes("\\"), "sem backslash após normalização")
})

test("treeIsDirtyOutside: mudança fora dos fixtures bloqueia; só dentro não", () => {
  assert.equal(treeIsDirtyOutside([" M src/index.js"], "tests/golden"), true)
  assert.equal(treeIsDirtyOutside([" M tests/golden/create-lite-dryrun.stdout.txt"], "tests/golden"), false)
  assert.equal(treeIsDirtyOutside([], "tests/golden"), false)
})

test("compareCase: exit divergente reprova antes de olhar fixture", () => {
  const bad = compareCase(GOLDEN_CASES[0], { exit: 1, stdout: "" }, FIXTURES)
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /exit/)
})
