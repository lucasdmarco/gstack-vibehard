import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("detectConflict: nome colide com skill de governança protegida -> conflict (S46.0)", async () => {
  const { detectConflict, PROTECTED_SKILL_NAMES } = await imp("src/dream/conflicts.js")
  assert.ok(PROTECTED_SKILL_NAMES.includes("skill-creator"))
  const r = detectConflict({ candidate: { title: "skill-creator" } })
  assert.equal(r.conflict, true)
  assert.match(r.reason, /governança protegida/i)
})

test("detectConflict: título comum, sem colisão -> conflict:false", async () => {
  const { detectConflict } = await imp("src/dream/conflicts.js")
  const r = detectConflict({ candidate: { title: "Resolver retry no deploy do Docker" } })
  assert.equal(r.conflict, false)
  assert.equal(r.reason, null)
})

test("detectConflict: normaliza antes de comparar (maiúscula/espaço não escapam)", async () => {
  const { detectConflict } = await imp("src/dream/conflicts.js")
  const r = detectConflict({ candidate: { title: "  Skill Creator  " } })
  assert.equal(r.conflict, true)
})

test("detectConflict: aceita lista de protectedNames customizada (injetável)", async () => {
  const { detectConflict } = await imp("src/dream/conflicts.js")
  const r = detectConflict({ candidate: { title: "meu-gate-critico" }, protectedNames: ["meu-gate-critico"] })
  assert.equal(r.conflict, true)
})
