import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const auditOf = (decisions) => ({ decisions })

test("vendorSkillName + vendorTargetDir: nome do dir da SKILL.md, alvo com slug", async () => {
  const { vendorSkillName, vendorTargetDir } = await imp("src/skills/vendor.js")
  assert.equal(vendorSkillName("skills/foo-bar/SKILL.md"), "foo-bar")
  assert.equal(vendorSkillName("hooks/pre.py"), "pre")
  assert.equal(vendorTargetDir("Some Repo", "Foo Bar"), "skills/vendor/some-repo/foo-bar")
})

test("buildVendorPlan: avoid excluído; sem mapeamento bloqueia apply; advisory sempre", async () => {
  const { buildVendorPlan, VENDOR_PLAN_SCHEMA } = await imp("src/skills/vendor.js")
  const audit = auditOf([
    { path: "skills/good/SKILL.md", hash: "sha256:g", decision: "adopt", risk: "low" },
    { path: "hooks/hook.py", hash: "sha256:h", decision: "adapt", risk: "medium" },
    { path: "danger.sh", hash: "sha256:d", decision: "avoid", risk: "high" },
  ])
  const plan = buildVendorPlan({ audit, source: "acme", license: "MIT" })
  assert.equal(plan.schemaVersion, VENDOR_PLAN_SCHEMA)
  assert.equal(plan.dryRun, true)
  assert.equal(plan.counts.planned, 2, "avoid não entra")
  assert.equal(plan.counts.excludedAvoid, 1)
  assert.deepEqual(plan.excludedAvoid, ["danger.sh"])
  assert.equal(plan.canApply, false, "sem mapeamento não aplica")
  assert.equal(plan.counts.needsMapping, 2)
  for (const e of plan.entries) {
    assert.equal(e.manifest.status, "advisory")
    assert.equal(e.manifest.test, "missing")
    assert.equal(e.manifest.license, "MIT")
  }
})

test("buildVendorPlan: mapeamento completo libera canApply", async () => {
  const { buildVendorPlan } = await imp("src/skills/vendor.js")
  const audit = auditOf([{ path: "skills/good/SKILL.md", hash: "h", decision: "adopt", risk: "low" }])
  const plan = buildVendorPlan({
    audit, source: "acme",
    mappings: { "skills/good/SKILL.md": { gate: "design-system-gate", agent: "frontend-dev" } },
  })
  assert.equal(plan.canApply, true)
  assert.equal(plan.counts.needsMapping, 0)
  assert.equal(plan.entries[0].manifest.mappedGate, "design-system-gate")
  assert.equal(plan.entries[0].manifest.mappedAgent, "frontend-dev")
})

test("skills vendor import --path (dry-run): NÃO escreve em skills/, grava o plano", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  const mirror = mkdtempSync(path.join(os.tmpdir(), "vendor-mirror-"))
  const work = mkdtempSync(path.join(os.tmpdir(), "vendor-work-"))
  try {
    mkdirSync(path.join(mirror, "skills", "nice"), { recursive: true })
    writeFileSync(path.join(mirror, "skills", "nice", "SKILL.md"), "# skill boa declarativa")
    writeFileSync(path.join(mirror, "LICENSE"), "MIT License\nCopyright")

    let out = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { out += s; return true }
    try { await skillsCommand(["vendor", "import", "--path", mirror, "--source", "acme", "--json"], { cwd: work }) } finally { process.stdout.write = orig }
    const plan = JSON.parse(out.trim().split("\n").pop())

    assert.equal(plan.applied, false, "dry-run não aplica")
    assert.equal(plan.entries[0].manifest.license, "MIT License")
    assert.ok(!existsSync(path.join(work, "skills", "vendor")), "dry-run NÃO cria skills/vendor")
    assert.ok(existsSync(path.join(work, ".gstack", "research", "vendor-plan.json")), "plano gravado em .gstack")
  } finally { rmSync(mirror, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }) }
})

test("skills vendor import --apply com mapeamento: escreve skills/vendor/<source>/<skill>/{SKILL.md,vendor.json}", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  const mirror = mkdtempSync(path.join(os.tmpdir(), "vendor-mirror-"))
  const work = mkdtempSync(path.join(os.tmpdir(), "vendor-work-"))
  try {
    mkdirSync(path.join(mirror, "skills", "nice"), { recursive: true })
    writeFileSync(path.join(mirror, "skills", "nice", "SKILL.md"), "# skill boa declarativa")
    const mapFile = path.join(work, "map.json")
    writeFileSync(mapFile, JSON.stringify({ "skills/nice/SKILL.md": { gate: "skill-route-gate", agent: "backend-dev" } }))

    let out = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { out += s; return true }
    try { await skillsCommand(["vendor", "import", "--path", mirror, "--source", "acme", "--map", mapFile, "--apply", "--json"], { cwd: work }) } finally { process.stdout.write = orig }
    const plan = JSON.parse(out.trim().split("\n").pop())

    assert.equal(plan.canApply, true)
    assert.equal(plan.applied, true)
    const vdir = path.join(work, "skills", "vendor", "acme", "nice")
    assert.ok(existsSync(path.join(vdir, "SKILL.md")), "SKILL.md vendado")
    const manifest = JSON.parse(readFileSync(path.join(vdir, "vendor.json"), "utf-8"))
    assert.equal(manifest.status, "advisory")
    assert.equal(manifest.mappedGate, "skill-route-gate")
    assert.equal(manifest.mappedAgent, "backend-dev")
  } finally { rmSync(mirror, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }) }
})
