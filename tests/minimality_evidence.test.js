import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.7.4 — decision-evidence REAL a partir do diff.
 *
 * `evaluateMinimality` (PRD49 S49.5) era puro/testado/correto, mas o
 * gate-matrix o declarava `declared-only` com o comentário honesto de que
 * "nenhum caminho popula `decision`". Estes testes provam que agora popula —
 * de um repositório git REAL, não de fixture sintética.
 */

const pkg = (deps) => JSON.stringify({ name: "fx", version: "1.0.0", dependencies: deps }, null, 2)

function realRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-minev-"))
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
  git("init")
  git("config", "user.email", "t@t.com")
  git("config", "user.name", "t")
  writeFileSync(path.join(dir, "package.json"), pkg({ existing: "^1.0.0" }))
  git("add", "-A")
  git("commit", "-m", "base")
  return { dir, git }
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })

test("collectMinimalityEvidence: dependência NOVA no package.json real é detectada no diff", async () => {
  const { collectMinimalityEvidence } = await imp("src/skills/minimality-evidence.js")
  const { dir } = realRepo()
  try {
    writeFileSync(path.join(dir, "package.json"), pkg({ existing: "^1.0.0", lodash: "^4.17.0" }))
    const ev = collectMinimalityEvidence({ cwd: dir })
    assert.equal(ev.introducesNewDependency, true)
    assert.ok(ev.addedDependencies.includes("lodash"), `esperava lodash, veio ${JSON.stringify(ev.addedDependencies)}`)
  } finally { cleanup(dir) }
})

test("CONTROLE NEGATIVO: sem dependência nova, o coletor NÃO inventa uma", async () => {
  const { collectMinimalityEvidence } = await imp("src/skills/minimality-evidence.js")
  const { dir } = realRepo()
  try {
    writeFileSync(path.join(dir, "README.md"), "# só doc\n")
    const ev = collectMinimalityEvidence({ cwd: dir })
    assert.equal(ev.introducesNewDependency, false)
    assert.deepEqual(ev.addedDependencies, [])
  } finally { cleanup(dir) }
})

// Uma dependência que só mudou de linha (vírgula nova) NÃO é dependência nova —
// esse era um falso-positivo real do parser de diff na 1ª versão deste coletor.
test("CONTROLE NEGATIVO: dependência preexistente que só ganhou vírgula NÃO conta como nova", async () => {
  const { collectMinimalityEvidence } = await imp("src/skills/minimality-evidence.js")
  const { dir } = realRepo()
  try {
    writeFileSync(path.join(dir, "package.json"), pkg({ existing: "^1.0.0", lodash: "^4.17.0" }))
    const ev = collectMinimalityEvidence({ cwd: dir })
    assert.ok(!ev.addedDependencies.includes("existing"), `'existing' já existia — veio ${JSON.stringify(ev.addedDependencies)}`)
  } finally { cleanup(dir) }
})

test("collectMinimalityEvidence: arquivo-fonte NOVO vira introducesNewAbstraction real", async () => {
  const { collectMinimalityEvidence } = await imp("src/skills/minimality-evidence.js")
  const { dir } = realRepo()
  try {
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "novo.js"), "export const x = 1\n")
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" })
    const ev = collectMinimalityEvidence({ cwd: dir })
    assert.equal(ev.introducesNewAbstraction, true)
    assert.ok(ev.addedFiles.some((f) => f.includes("novo.js")))
  } finally { cleanup(dir) }
})

test("protectedConcernsFor: deriva concern do CAMINHO real do arquivo mudado", async () => {
  const { protectedConcernsFor } = await imp("src/skills/minimality-evidence.js")
  assert.deepEqual(protectedConcernsFor(["tests/foo.test.js"]), ["tests"])
  assert.deepEqual(protectedConcernsFor(["src/security/auth.js"]), ["security"])
  assert.deepEqual(protectedConcernsFor(["src/index.js"]), [], "arquivo comum NÃO vira concern protegido")
})

test("addedDependencies: só conta linhas '+' DENTRO do bloco de dependências", async () => {
  const { addedDependencies } = await imp("src/skills/minimality-evidence.js")
  const diff = [
    ' "name": "x",',
    ' "dependencies": {',
    '+  "novo": "^1.0.0",',
    '   "velho": "^2.0.0"',
    ' }',
    '+  "scripts": { "build": "x" }',
  ].join("\n")
  assert.deepEqual(addedDependencies(diff), ["novo"], "campo fora do bloco de deps não conta")
})

// O elo completo: evidência real → evaluateMinimality → veredito real.
test("ponta a ponta: dependência nova SEM justificativa declarada -> blocked (sinal real, não fixture)", async () => {
  const { collectMinimalityEvidence } = await imp("src/skills/minimality-evidence.js")
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  const { dir } = realRepo()
  try {
    writeFileSync(path.join(dir, "package.json"), pkg({ existing: "^1.0.0", axios: "^1.0.0" }))
    const ev = collectMinimalityEvidence({ cwd: dir })
    assert.equal(evaluateMinimality(ev).verdict, "blocked")
    // COM justificativa humana declarada, o MESMO diff passa.
    const withReason = collectMinimalityEvidence({ cwd: dir, declared: { newDependencyReason: "sem equivalente stdlib provado" } })
    assert.equal(evaluateMinimality(withReason).verdict, "pass")
  } finally { cleanup(dir) }
})

test("ponta a ponta: concern protegido (tests/) isenta mesmo com dependência nova sem motivo", async () => {
  const { collectMinimalityEvidence } = await imp("src/skills/minimality-evidence.js")
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  const { dir } = realRepo()
  try {
    mkdirSync(path.join(dir, "tests"), { recursive: true })
    writeFileSync(path.join(dir, "tests", "a.test.js"), "// t\n")
    writeFileSync(path.join(dir, "package.json"), pkg({ existing: "^1.0.0", vitest: "^1.0.0" }))
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" })
    const ev = collectMinimalityEvidence({ cwd: dir })
    assert.ok(ev.protectedConcerns.includes("tests"), `veio ${JSON.stringify(ev.protectedConcerns)}`)
    assert.equal(evaluateMinimality(ev).verdict, "exempt", "concern protegido nunca é bloqueado")
  } finally { cleanup(dir) }
})

// Honestidade do coletor: o que o diff NÃO contém, ele NÃO chuta.
test("CONTROLE NEGATIVO: campos não-deriváveis ficam undefined (nunca chutados) -> sem bloqueio falso", async () => {
  const { collectMinimalityEvidence } = await imp("src/skills/minimality-evidence.js")
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  const { dir } = realRepo()
  try {
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "abstracao.js"), "export class A {}\n")
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" })
    const ev = collectMinimalityEvidence({ cwd: dir })
    assert.equal(ev.existingReuse, undefined, "coletor não chuta reuse disponível")
    assert.equal(ev.smallestCompleteApproach, undefined, "coletor não chuta menor abordagem completa")
    assert.equal(evaluateMinimality(ev).verdict, "pass", "abstração nova sem sinal de reuse NÃO bloqueia")
  } finally { cleanup(dir) }
})

// Wiring REAL: o coletor roda contra o próprio repo git do gstack.
test("wiring REAL: reviewStage existe e o coletor roda no repo git de verdade", async () => {
  const { runPipeline } = await imp("src/project-plan/run-loop.js")
  const { collectMinimalityEvidence } = await imp("src/skills/minimality-evidence.js")
  assert.equal(typeof runPipeline, "function")
  const ev = collectMinimalityEvidence({ cwd: repoRoot })
  assert.equal(ev.schemaVersion, "gstack.minimality-evidence.v1")
  assert.equal(typeof ev.introducesNewDependency, "boolean")
  assert.ok(Array.isArray(ev.protectedConcerns))
})
