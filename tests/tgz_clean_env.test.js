import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const readCi = () => readFileSync(path.join(repoRoot, ".github", "workflows", "test.yml"), "utf-8")

/**
 * PRD51 S51.9.4 — validar o pacote TGZ em ambiente limpo (§51.9 ação 6).
 *
 * Estado verificado: a infraestrutura **já existia e é séria** — não foi
 * preciso construir nada novo. `test:e2e:package` compõe `test-pack.mjs`
 * (npm pack → instala o .tgz num prefixo isolado → roda o bin) com
 * `test-e2e-lifecycle.mjs` (HOME descartável, ciclo doctor → dream audit →
 * create → agents check → install --audit-only → uninstall, e o contrato
 * "tarball == repo").
 *
 * Execução REAL desta sessão (Windows, node v24.14.0), `npm run
 * test:e2e:package` → **exit 0**: tarball com 1022 arquivos, sem
 * node_modules/__pycache__/.pyc, `dream audit no tarball: REAL=24 PLACEBO=0
 * (== repo)`, read-only sem footprint no HOME, `create` project-scoped,
 * `install --audit-only` gravando SÓ o relatório, `uninstall --restore-only`
 * seguro.
 *
 * Estes testes travam o que sustenta a alegação: que os scripts existem, que
 * o ciclo cross-OS roda na CI nos três sistemas, e que o contrato de verdade
 * do tarball não é um número fixo.
 */

test("os scripts que validam o TGZ existem de verdade (não é promessa de package.json)", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
  for (const s of ["test:pack", "test:e2e:package", "test:e2e:lifecycle", "test:cleanmachine"]) {
    assert.ok(pkg.scripts[s], `script ${s} declarado`)
  }
  for (const f of ["scripts/test-pack.mjs", "scripts/test-e2e-lifecycle.mjs", "scripts/test-package.mjs", "scripts/clean-machine-pack.mjs"]) {
    assert.ok(existsSync(path.join(repoRoot, f)), `${f} existe`)
  }
})

test("o ciclo de vida do TARBALL roda na CI nos TRÊS sistemas (não só Linux)", () => {
  const ci = readCi()
  const jobE2e = ci.slice(ci.indexOf("\n  e2e:"))
  assert.match(jobE2e, /ubuntu-latest/)
  assert.match(jobE2e, /windows-latest/)
  assert.match(jobE2e, /macos-latest/)
  assert.match(jobE2e, /test:e2e:lifecycle/, "é o lifecycle do tarball que roda na matriz, não um smoke qualquer")
})

test("o pack smoke do tarball real também roda na CI", () => {
  assert.match(readCi(), /npm run test:pack/)
})

// A invariante que impede o E2E de virar decorativo.
test("o contrato de verdade do tarball é COMPARADO com o repo, nunca um número fixo", () => {
  const src = readFileSync(path.join(repoRoot, "scripts", "test-e2e-lifecycle.mjs"), "utf-8")
  assert.match(src, /dream audit/i, "o ciclo roda o auditor dentro do tarball")
  // Invariante POSITIVA: o placar do tarball é confrontado com o do repo do
  // commit. Checar a AUSÊNCIA de "REAL===<n>" não serve — o próprio arquivo
  // comenta o bug histórico ("o CI quebrou com REAL===18 hardcoded") e a
  // primeira versão deste teste reprovou por causa do comentário, não do código.
  const semComentarios = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")
  assert.match(semComentarios, /s\.REAL\s*===\s*r\.REAL/, "compara tarball vs repo, não contra constante")
  assert.match(semComentarios, /s\.PLACEBO\s*===\s*0/, "e exige zero placebo no tarball")
  assert.ok(!/REAL\s*===\s*\d+/.test(semComentarios), "nenhuma contagem cravada no código do comparador")
})

test("o lifecycle usa HOME DESCARTÁVEL — o E2E nunca escreve na config real da máquina", () => {
  const src = readFileSync(path.join(repoRoot, "scripts", "test-e2e-lifecycle.mjs"), "utf-8")
  assert.match(src, /HOME:\s*home/, "injeta HOME isolado")
  assert.match(src, /USERPROFILE:\s*home/, "e o equivalente no Windows")
})

test("o tarball não pode carregar node_modules/__pycache__ (peso e vazamento)", () => {
  const src = readFileSync(path.join(repoRoot, "scripts", "test-pack.mjs"), "utf-8")
  assert.match(src, /node_modules/)
  assert.match(src, /__pycache__/)
})

// PRD51 S51.9.4 — detector de teste invisível (achado do S51.9.3).
test("existe detector de TESTE INVISÍVEL e ele é executável", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
  assert.ok(pkg.scripts["test:visibility"], "script test:visibility declarado")
  assert.ok(existsSync(path.join(repoRoot, "scripts", "check-test-visibility.mjs")))
})

test("staticTestCount conta declarações top-level e ignora string/comentário", async () => {
  const { staticTestCount } = await import(`file://${path.join(repoRoot, "scripts", "check-test-visibility.mjs").replace(/\\/g, "/")}`)
  const fonte = [
    'test("um", () => {})',
    'test("dois", async () => {})',
    '// test("comentado", () => {})',
    '  test("indentado — subteste, não conta", () => {})',
    'const s = \'test("dentro de string")\'',
  ].join("\n")
  assert.equal(staticTestCount(fonte), 2)
})
