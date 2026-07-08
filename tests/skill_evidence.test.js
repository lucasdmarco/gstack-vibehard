import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtempSync(path.join(tmpdir(), p))
const writeRun = (root, runId, file, obj) => {
  const dir = path.join(root, ".gstack", "runs", runId)
  mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, file), JSON.stringify(obj))
}

test("recordSkillEvidence: append tipado no ledger do run", async () => {
  const { recordSkillEvidence, readSkillEvidence, EVIDENCE_KINDS } = await imp("src/skills/evidence.js")
  const dir = mk("gstack-ev-")
  try {
    assert.ok(EVIDENCE_KINDS.includes("screenshot") && EVIDENCE_KINDS.includes("verify"))
    recordSkillEvidence({ root: dir, runId: "r1", kind: "question", gate: "existing-model-intake-gate", status: "answered", detail: "Figma" })
    const l = recordSkillEvidence({ root: dir, runId: "r1", kind: "verify", status: "ready" })
    assert.equal(l.entries.length, 2); assert.equal(l.schemaVersion, "gstack.skill-evidence.v1")
    assert.equal(readSkillEvidence({ root: dir, runId: "r1" }).entries.length, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("evaluateSkillGateRelease: sem runs → ok; violação/blocked → pendente", async () => {
  const { evaluateSkillGateRelease } = await imp("src/skills/evidence.js")
  const dir = mk("gstack-ev-rel-")
  try {
    assert.equal(evaluateSkillGateRelease({ root: dir }).ok, true, "sem runs = ok")
    writeRun(dir, "r-clean", "design-system-gate.json", { blocked: false })
    assert.equal(evaluateSkillGateRelease({ root: dir }).ok, true, "gate não bloqueado = ok")
    writeRun(dir, "r-bad", "skill-gate-violations.json", { gate: "design-system-gate", violations: [{ file: "x" }] })
    const r = evaluateSkillGateRelease({ root: dir })
    assert.equal(r.ok, false); assert.match(r.blocker, /skill-gate P0 pendente/)
    assert.ok(r.pendingGates.some((p) => p.run === "r-bad"))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("evaluateSkillGateRelease: design-system-gate blocked:true também é pendente", async () => {
  const { evaluateSkillGateRelease } = await imp("src/skills/evidence.js")
  const dir = mk("gstack-ev-ds-")
  try {
    writeRun(dir, "r", "design-system-gate.json", { blocked: true, violations: [{ file: "App.tsx" }] })
    assert.equal(evaluateSkillGateRelease({ root: dir }).ok, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("proof: skill-gate P0 pendente entra nos blockers (release falha)", async () => {
  const { buildProof } = await imp("src/commands/proof.js")
  const deps = {
    verify: () => ({ status: "ready", failed: [], timedOut: [] }),
    dream: () => ({ summary: { REAL: 1, PARTIAL: 0, PLACEBO: 0, ROADMAP: 0, RISK: 0 }, scope: {} }),
    readiness: () => ({ tools: { graphify: { status: "callable", freshness: { state: "fresh" } }, headroom: { status: "callable_not_routed" } } }),
    git: () => "",
    skillGateRelease: () => ({ ok: false, pendingGates: [{ run: "r", gate: "design-system-gate" }], blocker: "skill-gate P0 pendente em 1 run(s): design-system-gate" }),
  }
  const p = buildProof({ cwd: ".", deps })
  assert.equal(p.checks.skillGates.ok, false)
  assert.ok(p.blockers.some((b) => /skill-gate P0 pendente/.test(b)))
  assert.equal(p.ready, false)
})
