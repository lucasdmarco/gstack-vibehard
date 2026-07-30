import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanupTmp } from "./helpers/tmp.js"

const repoRoot = path.resolve(import.meta.dirname, "..")

/**
 * PRD51 S51.9.2 — typecheck REAL (§51.9 ações 3 e 4).
 *
 * Estado verificado antes: `npm run typecheck` e `npm run syntaxcheck` eram o
 * **mesmo comando** (`node scripts/lint.mjs --typecheck`) — o nome prometia
 * checagem de tipo e entregava checagem de sintaxe. Existia um
 * `typecheck:ts` (`tsc --noEmit -p jsconfig.json`), mas com `checkJs: false` e
 * **zero** arquivos marcados `// @ts-check` no repo: era um comando que passava
 * sempre, incapaz de reprovar qualquer erro de tipo em `src/`.
 *
 * Medição que definiu o desenho: ligar `checkJs: true` no repo inteiro produz
 * ~490 erros hoje, e o §10 do PRD51 lista "migrar todo JavaScript para
 * TypeScript" como **fora de escopo**. Então o gate é por adoção incremental:
 * quem declara `// @ts-check` é verificado de verdade e BLOQUEIA.
 */

// No Windows o binário é `tsc.cmd` e não spawna com shell:false — mesmo padrão
// já usado em runtime_e2e/test-pack.mjs.
const isWin = process.platform === "win32"
const tscBin = () => path.join(repoRoot, "node_modules", ".bin", isWin ? "tsc.cmd" : "tsc")
const tscInvocation = (args) => (isWin ? { file: "cmd.exe", argv: ["/c", tscBin(), ...args] } : { file: tscBin(), argv: args })
const execOutput = (e) => `${e.stdout || ""}${e.stderr || ""}`

function runTsc(args, cwd) {
  const { file, argv } = tscInvocation(args)
  try {
    return { code: 0, out: String(execFileSync(file, argv, { cwd, encoding: "utf-8", stdio: "pipe", timeout: 180000 }) || "") }
  } catch (e) {
    return { code: e.status ?? 1, out: execOutput(e) }
  }
}

// Todos os controles negativos usam o MESMO config mínimo: só muda o arquivo.
const NEG_TSCONFIG = JSON.stringify({
  compilerOptions: { module: "nodenext", moduleResolution: "nodenext", target: "es2022", checkJs: false, allowJs: true, noEmit: true, strict: true, noImplicitAny: false, skipLibCheck: true },
  include: ["*.js"],
})
function tscFixture(prefix, fileName, lines) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  writeFileSync(path.join(dir, "tsconfig.json"), NEG_TSCONFIG)
  writeFileSync(path.join(dir, fileName), lines.join("\n"))
  return dir
}

test("`npm run typecheck` e `npm run syntaxcheck` deixaram de ser o MESMO comando", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
  assert.notEqual(pkg.scripts.typecheck, pkg.scripts.syntaxcheck, "nome que promete tipo tem que checar tipo")
  assert.match(pkg.scripts.typecheck, /tsc --noEmit/, "typecheck é tsc real")
  assert.match(pkg.scripts.syntaxcheck, /lint\.mjs/, "syntaxcheck segue sendo node --check, separado")
})

test("o config do gate existe e é o que o script usa", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
  assert.match(pkg.scripts.typecheck, /tsconfig\.typecheck\.json/)
  const cfg = JSON.parse(readFileSync(path.join(repoRoot, "tsconfig.typecheck.json"), "utf-8"))
  assert.equal(cfg.compilerOptions.noEmit, true)
  assert.equal(cfg.compilerOptions.checkJs, false, "adoção incremental: só quem opta com // @ts-check")
})

test("o gate NÃO é vacuous: há arquivos de src/ realmente optados com `// @ts-check`", () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name)
    return e.isDirectory() ? walk(p) : (e.name.endsWith(".js") ? [p] : [])
  })
  const optados = walk(path.join(repoRoot, "src")).filter((p) => readFileSync(p, "utf-8").startsWith("// @ts-check"))
  assert.ok(optados.length >= 5, `esperava >=5 arquivos optados, achei ${optados.length} — gate vazio não prova nada`)
})

test("o repo atual PASSA no typecheck real (baseline verde de verdade)", () => {
  const r = runTsc(["--noEmit", "-p", "tsconfig.typecheck.json"], repoRoot)
  assert.equal(r.code, 0, `typecheck deveria passar no HEAD:\n${r.out.slice(0, 2000)}`)
})

// AÇÃO 4 do §51.9: controle negativo de erro de tipo. É isto que prova que o
// gate BLOQUEIA — sem ele, "typecheck passou" não significa nada.
test("CONTROLE NEGATIVO: erro de tipo REAL em arquivo `// @ts-check` REPROVA o tsc", () => {
  const dir = tscFixture("gstack-tsc-neg-", "ruim.js", [
      "// @ts-check",
      "/** @param {number} n */",
      "export function dobro(n) { return n * 2 }",
      'export const errado = dobro("não é número")',
    "",
  ])
  try {
    const r = runTsc(["--noEmit", "-p", "tsconfig.json"], dir)
    assert.notEqual(r.code, 0, "tsc TEM que reprovar um argumento de tipo errado")
    assert.match(r.out, /error TS2345/, `esperava TS2345 (argumento incompatível), veio:\n${r.out.slice(0, 1200)}`)
  } finally { cleanupTmp(dir) }
})

test("CONTROLE NEGATIVO: propriedade inexistente em objeto tipado REPROVA", () => {
  const dir = tscFixture("gstack-tsc-neg2-", "ruim2.js", [
      "// @ts-check",
      "const cfg = Object.freeze({ ready: true })",
    "export const valor = cfg.naoExiste",
    "",
  ])
  try {
    const r = runTsc(["--noEmit", "-p", "tsconfig.json"], dir)
    assert.notEqual(r.code, 0)
    assert.match(r.out, /error TS2339/, "propriedade inexistente é erro de tipo real")
  } finally { cleanupTmp(dir) }
})

// Prova de que a adoção incremental é intencional, não um furo: SEM `@ts-check`
// o mesmo erro passa — e é exatamente por isso que o opt-in tem que crescer.
test("SEM `// @ts-check` o mesmo erro NÃO é pego — o limite do gate é explícito, não escondido", () => {
  const dir = tscFixture("gstack-tsc-optout-", "sem-optin.js", [
      "/** @param {number} n */",
      "export function dobro(n) { return n * 2 }",
    'export const errado = dobro("não é número")',
    "",
  ])
  try {
    const r = runTsc(["--noEmit", "-p", "tsconfig.json"], dir)
    assert.equal(r.code, 0, "sem opt-in o arquivo não é verificado — limite conhecido e declarado")
  } finally { cleanupTmp(dir) }
})

test("strictNullChecks está LIGADO no gate (não é `strict:false` disfarçado)", () => {
  const cfg = JSON.parse(readFileSync(path.join(repoRoot, "tsconfig.typecheck.json"), "utf-8")).compilerOptions
  assert.equal(cfg.strict, true, "strict ligado")
  assert.equal(cfg.noImplicitAny, false, "só noImplicitAny fica fora — exigiria anotar o repo todo")
  assert.equal(cfg.noImplicitReturns, true)
  assert.equal(cfg.noUnusedLocals, true)
})

test("CONTROLE NEGATIVO: strictNullChecks pega de verdade um acesso possivelmente nulo", () => {
  const dir = tscFixture("gstack-tsc-null-", "nulo.js", [
      "// @ts-check",
      "/** @returns {{nome: string} | null} */",
      "function achar() { return null }",
    "export const n = achar().nome",
    "",
  ])
  try {
    const r = runTsc(["--noEmit", "-p", "tsconfig.json"], dir)
    assert.notEqual(r.code, 0, "acesso a possivelmente-nulo tem que reprovar")
    assert.match(r.out, /error TS(18047|2531|18048)/, `esperava erro de null, veio:\n${r.out.slice(0, 800)}`)
  } finally { cleanupTmp(dir) }
})
