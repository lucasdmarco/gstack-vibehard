import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD36 36.8 — skill reach por EVIDÊNCIA: quantas das N skills do catálogo cada
// harness realmente enxerga. instrucional vê ponteiro (não N skills); 0/N = a doc
// prometeu auto-load que não existe.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const catalog = { skills: [{ id: "start" }, { id: "frontend-design" }, { id: "chronicle" }, { id: "project-init" }] }

test("skills_dir: reach = interseção MEDIDA; missing lista o que falta", async () => {
  const { buildSkillReach } = await imp("src/skills/skill-reach.js")
  const io = { installedSkillIds: () => ["start", "chronicle"] }
  const rep = buildSkillReach({ catalog, harnesses: ["claude"], io })
  const claude = rep.rows[0]
  assert.equal(claude.mechanism, "skills_dir")
  assert.equal(claude.reachable, 2)
  assert.equal(claude.declared, 4)
  assert.deepEqual(claude.missing.sort(), ["frontend-design", "project-init"])
})

test("reach ZERO num skills_dir → ok:false e zeroReach (doc mente / não instalou)", async () => {
  const { buildSkillReach } = await imp("src/skills/skill-reach.js")
  const rep = buildSkillReach({ catalog, harnesses: ["opencode"], io: { installedSkillIds: () => [] } })
  assert.equal(rep.rows[0].reachable, 0)
  assert.equal(rep.ok, false)
  assert.deepEqual(rep.zeroReach, ["opencode"])
})

test("instrucional: reach por-skill é null (vê ponteiro, não N skills) e NÃO conta como zeroReach", async () => {
  const { buildSkillReach } = await imp("src/skills/skill-reach.js")
  const rep = buildSkillReach({ catalog, harnesses: ["codex", "cursor"], io: { installedSkillIds: () => [] } })
  for (const r of rep.rows) {
    assert.equal(r.mechanism, "instructional")
    assert.equal(r.reachable, null)
    assert.ok(r.pointer)
  }
  assert.equal(rep.ok, true, "instrucional nunca é zeroReach")
})

test("catálogo REAL: reach é medido (declared>0) e o resultado é honesto por harness", async () => {
  const { buildSkillReach } = await imp("src/skills/skill-reach.js")
  const { buildSkillCatalog } = await imp("src/skills/catalog.js")
  const rep = buildSkillReach({ catalog: buildSkillCatalog() })
  assert.ok(rep.declared > 50, `catálogo real tem muitas skills: ${rep.declared}`)
  const codex = rep.rows.find((r) => r.harness === "codex")
  assert.equal(codex.reachable, null, "codex é instrucional")
  // schema estável para o CLI/artefato
  assert.equal(rep.schemaVersion, "gstack.skill-reach.v1")
})

test("CLI skills reach --json: schema + rows por harness + artefato", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  const { mkdtemp, rm } = await import("node:fs/promises")
  const { existsSync } = await import("node:fs")
  const os = await import("node:os")
  const cwd = await mkdtemp(path.join(os.tmpdir(), "gstack-reach-"))
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await skillsCommand(["reach", "--json"], { cwd }) } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.skill-reach.v1")
  assert.ok(parsed.rows.length >= 4)
  assert.ok(existsSync(path.join(cwd, ".gstack", "skills", "skill-reach.json")))
  await rm(cwd, { recursive: true, force: true })
})
