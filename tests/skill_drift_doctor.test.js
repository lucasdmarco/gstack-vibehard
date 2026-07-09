import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const cat = (skills) => ({ totalSkills: skills.length, skills })

test("computeBaseline + diffBaseline: added/removed/drifted/unchanged", async () => {
  const { computeBaseline, diffBaseline } = await imp("src/skills/drift-doctor.js")
  const base = computeBaseline(cat([
    { path: "skills/a/SKILL.md", hash: "sha256:aaa" },
    { path: "skills/b/SKILL.md", hash: "sha256:bbb" },
  ]))
  const now = cat([
    { path: "skills/a/SKILL.md", hash: "sha256:aaa" },   // unchanged
    { path: "skills/b/SKILL.md", hash: "sha256:ZZZ" },   // drifted
    { path: "skills/c/SKILL.md", hash: "sha256:ccc" },   // added
  ])
  const d = diffBaseline(now, base)
  assert.equal(d.hasBaseline, true)
  assert.deepEqual(d.drifted, ["skills/b/SKILL.md"])
  assert.deepEqual(d.added, ["skills/c/SKILL.md"])
  assert.deepEqual(d.removed, [])   // nada sumiu (b mudou, não sumiu)
  assert.equal(d.unchanged, 1)
})

test("diffBaseline: sem baseline → hasBaseline false, tudo added", async () => {
  const { diffBaseline } = await imp("src/skills/drift-doctor.js")
  const d = diffBaseline(cat([{ path: "skills/a/SKILL.md", hash: "x" }]), null)
  assert.equal(d.hasBaseline, false)
  assert.deepEqual(d.added, ["skills/a/SKILL.md"])
})

test("citedCommands + staleCommands: detecta comando inexistente", async () => {
  const { citedCommands, staleCommands } = await imp("src/skills/drift-doctor.js")
  const body = "Rode `gstack_vibehard start` e depois `node src/index.js frobnicate` — gstack is a tool."
  const cited = citedCommands(body)
  assert.ok(cited.includes("start"))
  assert.ok(cited.includes("frobnicate"))
  const stale = staleCommands(cited)
  assert.deepEqual(stale, ["frobnicate"], "start existe; frobnicate não")
})

test("runDriftDoctor: stale reprova SEMPRE; drift só em --strict", async () => {
  const { runDriftDoctor } = await imp("src/skills/drift-doctor.js")
  const catalog = cat([
    { path: "skills/good/SKILL.md", id: "good", hash: "h1", risk: "low" },
    { path: "skills/bad/SKILL.md", id: "bad", hash: "h2", risk: "high" },
  ])
  const io = { read: (p) => (p.includes("bad") ? "use `gstack_vibehard ghostcmd` aqui" : "use `gstack_vibehard start` aqui") }
  const baseline = { hashes: { "skills/good/SKILL.md": "h1", "skills/bad/SKILL.md": "OLD" } } // bad drifted

  const soft = runDriftDoctor({ catalog, baseline, io, strict: false })
  assert.equal(soft.ok, false, "stale (ghostcmd) reprova mesmo sem strict")
  assert.equal(soft.stale.length, 1)
  assert.equal(soft.stale[0].id, "bad")
  assert.deepEqual(soft.risk.high, ["skills/bad/SKILL.md"])

  // sem stale mas com drift: passa soft, reprova strict
  const clean = { read: () => "use `gstack_vibehard start` aqui" }
  const softClean = runDriftDoctor({ catalog, baseline, io: clean, strict: false })
  assert.equal(softClean.ok, true, "sem stale e sem strict → ok apesar do drift")
  const strictClean = runDriftDoctor({ catalog, baseline, io: clean, strict: true })
  assert.equal(strictClean.ok, false, "drift reprova em strict")
})

test("runDriftDoctor sem io: só drift+risk, sem checar stale", async () => {
  const { runDriftDoctor } = await imp("src/skills/drift-doctor.js")
  const r = runDriftDoctor({ catalog: cat([{ path: "p", hash: "h", risk: "low" }]), baseline: null })
  assert.deepEqual(r.stale, [])
  assert.equal(r.ok, true)
})

test("CLI: skills baseline grava .gstack/skills/baseline.json (real)", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await skillsCommand(["baseline", "--json"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.skill-baseline.v1")
  assert.ok(parsed.totalSkills >= 200, `esperado 200+ skills, veio ${parsed.totalSkills}`)
})

test("CLI: skills doctor --json inclui drift/stale/risk (repo real)", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await skillsCommand(["doctor", "--json"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  process.exitCode = 0
  const j = JSON.parse(out.trim().split("\n").pop())
  assert.equal(typeof j.ok, "boolean")
  assert.ok(Array.isArray(j.findings), "mantém o contrato antigo do doctor")
  assert.ok(j.drift && typeof j.drift.hasBaseline === "boolean", "drift presente")
  assert.ok(Array.isArray(j.stale), "stale presente")
  assert.ok(j.risk && Array.isArray(j.risk.high), "risk presente")
})
