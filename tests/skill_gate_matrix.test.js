import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const fakeCatalog = (ids) => ({ totalSkills: ids.length, skills: ids.map((id) => ({ id })) })

test("acceptance PRD29: design-system-gate compila BLOCKING para touchesFrontend", async () => {
  const { buildGateMatrix, gatesForPhase } = await imp("src/skills/gate-matrix.js")
  const m = buildGateMatrix({ root: repoRoot })
  assert.equal(m.ok, true, `matriz real sem conflito: ${JSON.stringify(m.conflicts)}`)
  const frontend = gatesForPhase(m, "frontend") // alias → design-ui
  const ds = frontend.find((g) => g.id === "design-system-gate")
  assert.ok(ds, "design-system-gate presente na fase frontend")
  assert.equal(ds.mode, "blocking")
  assert.equal(ds.appliesWhen.touchesFrontend, true)
  assert.ok(ds.preconditions.some((p) => /designSystemGate\.status in complete\|generated/.test(p)))
})

test("matriz real: P0 essenciais presentes, verifier sempre determinístico (nunca LLM)", async () => {
  const { buildGateMatrix } = await imp("src/skills/gate-matrix.js")
  const m = buildGateMatrix({ root: repoRoot })
  const ids = m.gates.map((g) => g.id)
  for (const must of ["cwd-health-gate", "secret-deny-gate", "verify-proof-gate", "worktree-required-gate", "plan-before-code-gate"]) {
    assert.ok(ids.includes(must), `${must} no mapa manual`)
  }
  for (const g of m.gates) assert.ok(!/llm|model|ai/i.test(g.verifier), `verifier determinístico: ${g.id} = ${g.verifier}`)
  assert.equal(m.warnings.length, 0, `toda skill citada existe no catálogo real: ${JSON.stringify(m.warnings)}`)
})

test("conflito: mesmo path com conjuntos DISJUNTOS na mesma fase → ok:false", async () => {
  const { buildGateMatrix } = await imp("src/skills/gate-matrix.js")
  const gates = [
    { id: "a", phase: "design-ui", severity: "P0", mode: "blocking", skills: ["x"], appliesWhen: {}, preconditions: ["ds.status in complete"], requiredQuestions: [], requiredEvidence: [], verifier: "file-exists", fallback: "block" },
    { id: "b", phase: "design-ui", severity: "P0", mode: "blocking", skills: ["x"], appliesWhen: {}, preconditions: ["ds.status in skipped"], requiredQuestions: [], requiredEvidence: [], verifier: "file-exists", fallback: "block" },
  ]
  const m = buildGateMatrix({ catalog: fakeCatalog(["x"]), gates })
  assert.equal(m.ok, false)
  assert.equal(m.conflicts.length, 1)
  assert.deepEqual(m.conflicts[0].gates, ["a", "b"])
  // overlap (complete|skipped vs skipped) NÃO é conflito — satisfazível
  gates[0].preconditions = ["ds.status in complete|skipped"]
  assert.equal(buildGateMatrix({ catalog: fakeCatalog(["x"]), gates }).ok, true)
})

test("skill desconhecida no catálogo = WARNING (não bloqueia a compilação)", async () => {
  const { buildGateMatrix } = await imp("src/skills/gate-matrix.js")
  const gates = [{ id: "g", phase: "security", severity: "P1", mode: "advisory", skills: ["nao-existe"], appliesWhen: {}, preconditions: [], requiredQuestions: [], requiredEvidence: [], verifier: "file-exists", fallback: "warn" }]
  const m = buildGateMatrix({ catalog: fakeCatalog(["outra"]), gates })
  assert.equal(m.ok, true)
  assert.deepEqual(m.warnings, [{ gate: "g", kind: "unknown_skill", skills: ["nao-existe"] }])
})

test("CLI: skills gates show --phase frontend --json = JSON puro + artefatos gravados", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  const { existsSync } = await import("node:fs")
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await skillsCommand(["gates", "show", "--phase", "frontend", "--json"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  const j = JSON.parse(buf.trim())
  assert.equal(j.schemaVersion, "gstack.skill-gate-matrix.v1")
  assert.equal(j.phaseFilter, "frontend")
  assert.ok(j.gates.every((g) => g.phase === "design-ui"), "filtro aplicado via alias")
  assert.ok(existsSync(path.join(repoRoot, ".gstack", "skills", "gate-matrix.json")), "artefato JSON gravado")
  assert.ok(existsSync(path.join(repoRoot, ".gstack", "skills", "gate-matrix.md")), "artefato MD gravado")
})
