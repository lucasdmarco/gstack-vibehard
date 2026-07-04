import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "tools", "refresh.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

const ok = (summary, raw) => () => ({ ok: true, code: 0, summary: summary || "ok", raw: raw || "" })
const fail = (summary) => () => ({ ok: false, code: 1, summary: summary || "boom", raw: "" })

// runners que nunca spawnam nada real
function goodRunners(extra = {}) {
  return {
    changedFiles: () => ["src/index.js"],
    graphify: ok("graph atualizado"),
    contextIndex: ok("indexado"),
    headroomDoctor: ok("proxy stopped; not routed"),
    fallowAudit: ok("audit", JSON.stringify({ verdict: "fail", summary: { dead_code_issues: 5, max_cyclomatic: 6 } })),
    verify: ok("verify ok"),
    ...extra,
  }
}

test("buildToolRefresh: grava report + readiness; passos ok; nunca spawna (runners injetados)", async () => {
  const { buildToolRefresh } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-refresh-"))
  try {
    const rep = buildToolRefresh({ cwd, runners: goodRunners(), runId: "r1" })
    assert.equal(rep.ok, true)
    assert.deepEqual(rep.steps.map((s) => s.tool), ["graphify", "context", "headroom", "fallow"])
    assert.ok(rep.steps.every((s) => s.status === "ok"))
    assert.ok(rep.steps.every((s) => !("raw" in s)), "raw (stdout completo) não vaza pro report")
    // artefatos project-scoped
    assert.ok(existsSync(rep.writtenTo) && /tool-refresh[\\/]r1\.json$/.test(rep.writtenTo))
    assert.ok(existsSync(rep.readinessPath))
    // readiness foi alimentado com o AUDIT fresco do refresh
    const readiness = JSON.parse(await readFile(rep.readinessPath, "utf-8"))
    assert.equal(readiness.tools.fallow.auditSummary.verdict, "fail")
    assert.equal(readiness.tools.fallow.auditSummary.deadCode, 5)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("buildToolRefresh --changed: pula graphify quando nenhum arquivo relevante mudou", async () => {
  const { buildToolRefresh } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-refresh-"))
  try {
    const runners = goodRunners({ changedFiles: () => ["README.md", "docs/x.md"] })
    const rep = buildToolRefresh({ cwd, changed: true, runners, write: false })
    assert.equal(rep.steps.find((s) => s.tool === "graphify").status, "skipped")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("falha de etapa = degraded no modo normal, error (bloqueia) só em --strict", async () => {
  const { buildToolRefresh } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-refresh-"))
  try {
    const runners = goodRunners({ contextIndex: fail("db travou") })
    // normal: degraded, ok geral true
    const normal = buildToolRefresh({ cwd, runners, write: false })
    assert.equal(normal.steps.find((s) => s.tool === "context").status, "degraded")
    assert.equal(normal.ok, true, "degraded não bloqueia o usuário comum")
    // strict: context é bloqueante → error → ok geral false
    const strict = buildToolRefresh({ cwd, strict: true, runners, write: false })
    assert.equal(strict.steps.find((s) => s.tool === "context").status, "error")
    assert.equal(strict.ok, false)
    assert.ok(strict.steps.some((s) => s.tool === "verify"), "strict adiciona a etapa verify")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("headroom só classifica (doctor) — o runner nunca liga proxy/wrap", async () => {
  const { buildToolRefresh, defaultRunners } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-refresh-"))
  try {
    // defaultRunners existe e expõe headroomDoctor (doctor), não enable/wrap
    const dr = defaultRunners(cwd)
    assert.equal(typeof dr.headroomDoctor, "function")
    assert.ok(!("headroomEnable" in dr) && !("wrap" in dr), "sem enable/wrap nos runners")
    const rep = buildToolRefresh({ cwd, runners: goodRunners(), write: false })
    assert.equal(rep.steps.find((s) => s.tool === "headroom").status, "ok")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
