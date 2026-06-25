import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")

test("skill /start existe com trigger correto", () => {
  const p = path.join(repoRoot, "skills", "skills", "start", "SKILL.md")
  assert.ok(existsSync(p), "skills/skills/start/SKILL.md presente")
  const skill = readFileSync(p, "utf-8")
  assert.match(skill, /trigger:\s*\/start/, "trigger /start")
  assert.match(skill, /gstack_vibehard start/, "mapeia p/ o comando real")
})

test("/start aparece ANTES de /newproject no guidance de cada harness", () => {
  for (const f of ["claude.js", "codex.js", "opencode.js"]) {
    const src = readFileSync(path.join(repoRoot, "src", "harness", f), "utf-8")
    const iStart = src.indexOf("/start")
    const iNew = src.indexOf("/newproject")
    assert.ok(iStart !== -1, `${f} menciona /start`)
    assert.ok(iNew !== -1, `${f} menciona /newproject`)
    assert.ok(iStart < iNew, `${f}: /start vem antes de /newproject`)
  }
})
