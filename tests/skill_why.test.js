import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("explainGate: why + howToSatisfy + fallbackMeaning por gate", async () => {
  const { explainGate, GATE_EXPLAIN_SCHEMA } = await imp("src/skills/gate-matrix.js")
  const gate = {
    id: "x-gate", phase: "design-ui", severity: "P0", mode: "blocking",
    skills: ["frontend-design"], appliesWhen: { touchesFrontend: true },
    preconditions: ["a in b"], requiredQuestions: ["Tem design system?"],
    requiredEvidence: [".gstack/design-system.json"], verifier: "json-schema",
    fallback: "block_before_write",
  }
  const x = explainGate(gate)
  assert.equal(x.schemaVersion, GATE_EXPLAIN_SCHEMA)
  assert.equal(x.gate, "x-gate")
  assert.match(x.why, /DECIDE/)
  assert.match(x.why, /blocking/)
  assert.equal(x.fallbackMeaning, "bloqueia a escrita até a precondição ser satisfeita")
  assert.match(x.howToSatisfy, /design-system\.json/, "evidência tem prioridade")
})

test("explainGate: advisory sem evidência → howToSatisfy usa a pergunta", async () => {
  const { explainGate } = await imp("src/skills/gate-matrix.js")
  const x = explainGate({
    id: "adv", phase: "intake-onboarding", severity: "P1", mode: "advisory",
    skills: ["find-skills"], appliesWhen: {}, preconditions: [],
    requiredQuestions: ["Usar as skills recomendadas?"], requiredEvidence: [],
    verifier: "json-schema", fallback: "warn_and_log",
  })
  assert.match(x.why, /advisory/)
  assert.equal(x.fallbackMeaning, "apenas avisa e registra (advisory)")
  assert.match(x.howToSatisfy, /Usar as skills/)
})

test("skills why <gate> (real): explica com enforcement por harness", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await skillsCommand(["why", "secret-deny-gate", "--json"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  const x = JSON.parse(out.trim().split("\n").pop())
  assert.equal(x.gate, "secret-deny-gate")
  assert.equal(x.enforcement.claude, "enforced", "pre-write com hook no claude")
  assert.equal(x.enforcement.codex, "advisory", "codex sem hook pre-tool")
})

test("skills why <gate desconhecido> → erro honesto, exitCode 1", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  const prev = process.exitCode
  const r = await skillsCommand(["why", "nao-existe"], { cwd: repoRoot })
  assert.equal(r, null)
  assert.equal(process.exitCode, 1)
  process.exitCode = prev || 0
})
