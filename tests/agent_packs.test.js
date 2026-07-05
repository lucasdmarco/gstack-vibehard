import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const packsRoot = path.join(repoRoot, "agent-packs")

function packDirs() {
  if (!existsSync(packsRoot)) return []
  return readdirSync(packsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
}

test("agent-packs: cada pack tem PACK.md, CATALOG.md, CHANGELOG.md", () => {
  const packs = packDirs()
  assert.ok(packs.length >= 1, "existe ao menos 1 pack")
  for (const p of packs) {
    for (const req of ["PACK.md", "CATALOG.md", "CHANGELOG.md"]) {
      assert.ok(existsSync(path.join(packsRoot, p, req)), `${p}/${req} presente`)
    }
  }
})

test("agent-packs: cada skill tem SKILL.md + actions 01-plan/02-execute/03-verify", () => {
  for (const p of packDirs()) {
    const skillsRoot = path.join(packsRoot, p, "skills")
    assert.ok(existsSync(skillsRoot), `${p}/skills existe`)
    const skills = readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory())
    assert.ok(skills.length >= 1, `${p} tem ao menos 1 skill`)
    for (const s of skills) {
      const sDir = path.join(skillsRoot, s.name)
      assert.ok(existsSync(path.join(sDir, "SKILL.md")), `${p}/${s.name}/SKILL.md`)
      for (const a of ["01-plan.md", "02-execute.md", "03-verify.md"]) {
        assert.ok(existsSync(path.join(sDir, "actions", a)), `${p}/${s.name}/actions/${a}`)
      }
    }
  }
})

// Uma linha "afirma que o LLM aprova" só se cita LLM/IA aprovando E não tem negação.
function assertsLlmGate(line) {
  const positive = /\b(LLM|IA)\b.*\b(aprova|decide|libera|autoriza|é o gate)\b/i
  const negated = /\b(nunca|never|não|nao|jamais|advisory|advisória)\b/i
  return positive.test(line) && !negated.test(line)
}

test("agent-packs: NENHUMA action promete gate por LLM (invariante)", () => {
  for (const p of packDirs()) {
    const skillsRoot = path.join(packsRoot, p, "skills")
    for (const s of readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      for (const a of ["01-plan.md", "02-execute.md", "03-verify.md"]) {
        const md = readFileSync(path.join(skillsRoot, s.name, "actions", a), "utf-8")
        const offending = md.split(/\r?\n/).filter(assertsLlmGate)
        assert.deepEqual(offending, [], `${p}/${s.name}/${a}: linha promete gate por LLM → ${offending[0] || ""}`)
      }
      // a action de verify DEVE afirmar explicitamente o gate determinístico.
      const verify = readFileSync(path.join(skillsRoot, s.name, "actions", "03-verify.md"), "utf-8")
      assert.match(verify, /LLM nunca é o gate|gate determin[ií]stico/i, `${p}/${s.name} verify afirma determinismo`)
    }
  }
})
