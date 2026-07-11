import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD36 36.8b — paridade cross-platform do onboarding: skill de onboarding não
// pode ter fence ```bash com PowerShell (quebra quem copia no bash/macOS/Linux).

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// Enumera todos os SKILL.md versionados (skills/, agent-packs/, agents/).
async function allSkills() {
  const { readdirSync } = await import("node:fs")
  const roots = ["skills", "agent-packs", "agents"]
  const out = []
  const walk = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue
      const childAbs = path.join(abs, e.name)
      if (e.isDirectory()) walk(childAbs, `${rel}/${e.name}`)
      else if (e.name === "SKILL.md") out.push({ name: `${rel}/${e.name}`, text: readFileSync(childAbs, "utf-8") })
    }
  }
  for (const r of roots) { try { walk(path.join(repoRoot, r), r) } catch { /* raiz ausente */ } }
  return out
}

test("lintShellFences: fence ```bash com .ps1/$env: é flagrado; ```powershell e ```text não", async () => {
  const { lintShellFences } = await imp("src/meta/command-lint.js")
  assert.equal(lintShellFences("```bash\n& \"$env:USERPROFILE\\setup.ps1\"\n```").length, 1)
  assert.equal(lintShellFences("```sh\nCopy-Item a b\n```").length, 1)
  assert.equal(lintShellFences("```powershell\nCopy-Item a b\n```").length, 0, "powershell é honesto")
  assert.equal(lintShellFences("```text\n& \"$env:X\\y.ps1\"\n```").length, 0, "text não promete shell")
  assert.equal(lintShellFences("```bash\nnpm run dev\n```").length, 0, "bash real passa")
})

test("NENHUMA skill do produto tem fence ```bash/sh com PowerShell (36.8b)", async () => {
  const { lintShellFences } = await imp("src/meta/command-lint.js")
  const skills = await allSkills()
  assert.ok(skills.length > 0, "achou skills")
  const offenders = skills
    .map((s) => ({ name: s.name, bad: lintShellFences(s.text) }))
    .filter((s) => s.bad.length > 0)
  assert.deepEqual(offenders, [], `fences shell com PowerShell:\n${offenders.map((o) => `${o.name}: ${JSON.stringify(o.bad)}`).join("\n")}`)
})

test("runSkillLint: project-init está limpo (sem comando inexistente nem fence quebrado)", async () => {
  const { runSkillLint } = await imp("src/meta/command-lint.js")
  const text = readFileSync(path.join(repoRoot, "skills", "skills", "project-init", "SKILL.md"), "utf-8")
  const rep = runSkillLint({ skills: [{ name: "project-init", text }] })
  assert.equal(rep.ok, true, JSON.stringify(rep.perSkill))
})

test("runSkillLint: uma skill com fence quebrado E comando fake reprova", async () => {
  const { runSkillLint } = await imp("src/meta/command-lint.js")
  const bad = "Rode `gstack_vibehard naoexiste`.\n\n```bash\nCopy-Item a b\n```\n"
  const rep = runSkillLint({ skills: [{ name: "bad", text: bad }] })
  assert.equal(rep.ok, false)
  assert.ok(rep.perSkill[0].unknown.includes("naoexiste"))
  assert.equal(rep.perSkill[0].shellFences.length, 1)
})
