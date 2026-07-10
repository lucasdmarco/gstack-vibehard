import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD36 36.0 — verdade dos gates: declared ≠ routed ≠ executed ≠ blocking ≠ proved.
// Um gate só é `enforced` com implementação + bloqueio real + TESTE NEGATIVO
// verificado. Matriz válida NUNCA vira "12/12" sozinha.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const provedIo = { readTest: () => "arquivo contendo: nome do teste negativo" }
const brokenIo = { readTest: () => null }
const ref = { test: "tests/qualquer.test.js", name: "nome do teste negativo" }

test("verifyProvedBy: sem provedBy não é proved nem broken; com prova verificada é proved; citação sem arquivo é BROKEN", async () => {
  const { verifyProvedBy } = await imp("src/skills/gate-truth.js")
  assert.deepEqual(verifyProvedBy({ id: "g" }, provedIo), { proved: false, broken: false })
  assert.deepEqual(verifyProvedBy({ id: "g", provedBy: ref }, provedIo), { proved: true, broken: false })
  assert.deepEqual(verifyProvedBy({ id: "g", provedBy: ref }, brokenIo), { proved: false, broken: true })
  // arquivo existe mas NÃO contém o nome citado → claim sem evidência
  const wrongName = { readTest: () => "outro conteudo" }
  assert.deepEqual(verifyProvedBy({ id: "g", provedBy: ref }, wrongName), { proved: false, broken: true })
})

test("gateTruth: os 5 estados são independentes (declarado-apenas não roteia execução nem bloqueio)", async () => {
  const { gateTruth } = await imp("src/skills/gate-truth.js")
  const declaredOnly = { id: "d", mode: "blocking", fallback: "block_before_ship" }
  const t = gateTruth(declaredOnly, "claude", false)
  assert.deepEqual(t, { declared: true, routed: true, executed: false, blocking: false, proved: false })

  const implemented = { id: "i", mode: "blocking", fallback: "block_before_write", implementedBy: "src/x.js" }
  const ti = gateTruth(implemented, "claude", false)
  assert.equal(ti.executed, true)
  assert.equal(ti.blocking, true, "claude intercepta file.write")
  assert.equal(ti.proved, false, "sem teste negativo não é proved")

  // codex não intercepta escrita: routed=false, blocking=false mesmo implementado
  const tc = gateTruth(implemented, "codex", false)
  assert.equal(tc.routed, false)
  assert.equal(tc.blocking, false)

  // opencode file.write=partial: recebe o evento (routed) mas não GARANTE negação
  const to = gateTruth(implemented, "opencode", false)
  assert.equal(to.routed, true)
  assert.equal(to.blocking, false)
})

test("truthLevel: enforced exige executed+blocking+proved — nunca só a matriz", async () => {
  const { gateTruth, truthLevel } = await imp("src/skills/gate-truth.js")
  const gate = { id: "g", mode: "blocking", fallback: "block_before_ship", implementedBy: "src/x.js" }
  const semProva = gateTruth(gate, "codex", false)
  assert.equal(truthLevel(gate, "codex", semProva), "advisory")
  const comProva = gateTruth(gate, "codex", true)
  assert.equal(truthLevel(gate, "codex", comProva), "enforced")
  assert.equal(truthLevel(gate, "windsurf", comProva), "unsupported")
})

test("matriz REAL: nunca 12/12 — declared > executed > proved; gates só-declarados nunca enforced", async () => {
  const { buildGateTruth, truthSummary } = await imp("src/skills/gate-truth.js")
  const { SKILL_GATES } = await imp("src/skills/gate-matrix.js")
  const truth = buildGateTruth({ gates: SKILL_GATES })
  const s = truthSummary(truth)

  assert.ok(s.declared >= 12)
  assert.ok(s.executed < s.declared, `executed (${s.executed}) < declared (${s.declared}) — honestidade`)
  assert.ok(s.proved < s.executed, `proved (${s.proved}) < executed (${s.executed}) — prova é mais rara que impl`)
  assert.equal(truth.ok, true, `nenhuma prova citada pode estar quebrada: ${truth.brokenRefs.join(", ")}`)

  // toda prova citada foi VERIFICADA contra o arquivo de teste real do repo
  for (const r of truth.rows.filter((x) => x.provedBy)) assert.equal(r.provedByBroken, false, r.gate)

  // os declarados-apenas do audit (visual/db/rls/context-pack) NÃO aparecem enforced em lugar nenhum
  for (const id of ["visual-validation-gate", "db-migration-gate", "rls-gate", "context-pack-required-gate"]) {
    const row = truth.rows.find((r) => r.gate === id)
    const levels = Object.values(row.byHarness).map((h) => h.level)
    assert.ok(levels.every((l) => l !== "enforced"), `${id} não pode fingir enforcement: ${levels}`)
  }

  // verify-proof-gate (ship, implementado, provado) é enforced em todos os 4
  const vp = truth.rows.find((r) => r.gate === "verify-proof-gate")
  for (const h of truth.harnesses) assert.equal(vp.byHarness[h].level, "enforced")

  // design-system-gate (pre-write provado): enforced SÓ onde a escrita é interceptada
  const ds = truth.rows.find((r) => r.gate === "design-system-gate")
  assert.equal(ds.byHarness.claude.level, "enforced")
  assert.equal(ds.byHarness.codex.level, "advisory")
})

test("prova citada que NÃO existe → ok:false + brokenRefs (mentira na matriz reprova)", async () => {
  const { buildGateTruth } = await imp("src/skills/gate-truth.js")
  const gates = [{ id: "fake", mode: "blocking", fallback: "block_before_ship", implementedBy: "src/x.js", provedBy: { test: "tests/nao_existe.test.js", name: "x" } }]
  const truth = buildGateTruth({ gates })
  assert.equal(truth.ok, false)
  assert.deepEqual(truth.brokenRefs, ["fake"])
  assert.equal(truth.rows[0].byHarness.claude.level, "advisory", "prova quebrada nunca sustenta enforced")
})

test("CLI skills gates doctor --json: schema + summary + artefatos .gstack/skills/gate-truth.*", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-truth-"))
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await skillsCommand(["gates", "doctor", "--json"], { cwd }) } finally { process.stdout.write = orig }
  try {
    const parsed = JSON.parse(out.trim().split("\n").pop())
    assert.equal(parsed.schemaVersion, "gstack.skill-gate-truth.v1")
    assert.ok(parsed.summary.declared >= 12)
    assert.ok(parsed.summary.proved < parsed.summary.declared, "doctor nunca reporta tudo provado só pela matriz")
    assert.ok(parsed.rows.every((r) => ["declared", "routed", "executed", "blocking", "proved"].every((k) => k in r.byHarness.claude)))
    assert.ok(existsSync(path.join(cwd, ".gstack", "skills", "gate-truth.json")))
    assert.ok(existsSync(path.join(cwd, ".gstack", "skills", "gate-truth.md")))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
