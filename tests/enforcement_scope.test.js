import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.7.8 — classificação clara de enforcement POR HARNESS.
 *
 * Achado: duas afirmações do próprio repo pareciam se contradizer e as duas
 * são VERDADEIRAS — `design-hooks.js` diz "Codex não tem API de hook
 * project-local" e `codex.js` escreve hooks REAIS. A `ADAPTER_MATRIX`
 * declarava o NÍVEL de enforcement mas não tinha eixo pra ONDE ele mora, e sem
 * esse eixo as duas frases leem como conflito. Este é o eixo que faltava.
 */

test("a reconciliação é DADO, não comentário: Codex tem hook real E não tem API project-local", async () => {
  const { ENFORCEMENT_SCOPE, PROJECT_LOCAL_HOOK_API } = await imp("src/harness/enforcement-scope.js")
  const { ADAPTER_MATRIX } = await imp("src/agents/adapter-matrix.js")
  assert.notEqual(ADAPTER_MATRIX.codex.enforcement, "instructional", "o Codex TEM mecanismo de hook real")
  assert.equal(ENFORCEMENT_SCOPE.codex.scope, "global_only", "…mas o hook mora só em ~/.codex")
  assert.equal(PROJECT_LOCAL_HOOK_API.codex, false, "…e não há API de hook project-local — as duas frases coexistem")
  assert.equal(ENFORCEMENT_SCOPE.codex.projectLocal.length, 0)
})

test("todo escopo declarado é um valor do vocabulário e todo harness declara onde bloqueia", async () => {
  const { ENFORCEMENT_SCOPE, ENFORCEMENT_SCOPES } = await imp("src/harness/enforcement-scope.js")
  for (const [harness, row] of Object.entries(ENFORCEMENT_SCOPE)) {
    assert.ok(ENFORCEMENT_SCOPES.includes(row.scope), `${harness}: escopo válido`)
    assert.ok([null, "global", "projectLocal"].includes(row.blockingSurface), `${harness}: blockingSurface honesto`)
    assert.ok(row.note && row.note.length > 20, `${harness}: nota explica o porquê, não só rotula`)
  }
})

test("escopo `none` NUNCA declara superfície que bloqueia (instrucional não é enforcement)", async () => {
  const { ENFORCEMENT_SCOPE } = await imp("src/harness/enforcement-scope.js")
  for (const [harness, row] of Object.entries(ENFORCEMENT_SCOPE)) {
    if (row.scope === "none") assert.equal(row.blockingSurface, null, `${harness}: escopo none não pode bloquear`)
  }
})

test("`global_only`/`project_local_only` são coerentes com as superfícies listadas", async () => {
  const { ENFORCEMENT_SCOPE } = await imp("src/harness/enforcement-scope.js")
  for (const [harness, row] of Object.entries(ENFORCEMENT_SCOPE)) {
    if (row.scope === "global_only") assert.equal(row.projectLocal.length, 0, `${harness}: global_only sem superfície local`)
    if (row.scope === "project_local_only") assert.equal(row.global.length, 0, `${harness}: project_local_only sem superfície global`)
    if (row.scope === "both") assert.ok(row.global.length && row.projectLocal.length, `${harness}: both exige as duas`)
  }
})

// O que impede a declaração de virar prosa desatualizada.
test("scopeDrift: toda superfície declarada aponta um módulo REAL que ainda a escreve", async () => {
  const { scopeDrift } = await imp("src/harness/enforcement-scope.js")
  assert.deepEqual(scopeDrift(), [], "nenhuma declaração sem sustentação no código")
})

test("CONTROLE NEGATIVO: se o módulo escritor sumir, scopeDrift ACUSA (não passa calado)", async () => {
  const { scopeDrift } = await imp("src/harness/enforcement-scope.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-scope-"))
  try {
    const drift = scopeDrift(dir) // raiz vazia: nenhum writer existe
    assert.ok(drift.length > 0, "raiz sem writers tem que acusar drift")
    assert.ok(drift.every((d) => d.problem === "missingWriter"))
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test("CONTROLE NEGATIVO: writer existe mas SEM o caminho declarado -> missingEvidence", async () => {
  const { scopeDrift } = await imp("src/harness/enforcement-scope.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-scope-"))
  try {
    mkdirSync(path.join(dir, "harness"), { recursive: true })
    for (const f of ["claude.js", "codex.js", "cursor.js", "opencode.js", "design-hooks.js", "devin.js", "hermes.js"]) {
      writeFileSync(path.join(dir, "harness", f), "// arquivo existe mas não escreve mais nada disso\n")
    }
    const drift = scopeDrift(dir)
    assert.ok(drift.length > 0)
    assert.ok(drift.every((d) => d.problem === "missingEvidence"), "detecta declaração stale, não só arquivo ausente")
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test("escopo e ADAPTER_MATRIX não podem divergir (todo harness da matriz tem escopo e vice-versa)", async () => {
  const { scopeMatrixGaps } = await imp("src/harness/enforcement-scope.js")
  const gaps = scopeMatrixGaps()
  assert.deepEqual(gaps.matrixWithoutScope, [], "harness na matriz sem escopo declarado")
  assert.deepEqual(gaps.scopeWithoutMatrix, [], "escopo declarado pra harness fora da matriz")
})

test("Devin é o ÚNICO com hook real project-local — a exceção fica explícita, não implícita", async () => {
  const { ENFORCEMENT_SCOPE } = await imp("src/harness/enforcement-scope.js")
  const locais = Object.entries(ENFORCEMENT_SCOPE).filter(([, r]) => r.blockingSurface === "projectLocal").map(([h]) => h)
  assert.deepEqual(locais, ["devin"])
})

test("o comentário do design-hooks.js aponta o eixo — a doc não fica órfã do dado", async () => {
  const src = readFileSync(path.join(repoRoot, "src", "harness", "design-hooks.js"), "utf-8")
  assert.match(src, /enforcement-scope\.js/, "o arquivo que gerou a confusão cita onde a resposta mora")
  assert.match(src, /PROJECT-LOCAL/, "a afirmação original ficou qualificada, não apagada")
})

async function captureStdout(fn) {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await fn() } finally { process.stdout.write = orig }
  return out.trim().split("\n").pop()
}

test("CLI REAL: `agents enforcement --json` reporta a tabela e ok:true no repo atual", async () => {
  const { agentsCommand } = await imp("src/commands/agents.js")
  const out = JSON.parse(await captureStdout(() => agentsCommand(["enforcement", "--json"], {})))
  assert.equal(out.schemaVersion, "gstack.enforcement-scope.v1")
  assert.equal(out.ok, true)
  const codex = out.harnesses.find((h) => h.harness === "codex")
  assert.equal(codex.projectLocalHookApi, false)
  assert.equal(codex.scope, "global_only")
})
