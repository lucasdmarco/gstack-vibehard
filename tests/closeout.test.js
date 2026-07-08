import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtempSync(path.join(tmpdir(), p))

test("buildCloseout: schema + campos; renderCloseoutMarkdown resume", async () => {
  const { buildCloseout, renderCloseoutMarkdown } = await imp("src/skills/closeout.js")
  const c = buildCloseout({ runId: "r1", command: "start", status: "done", changed: ["a.js", "b.js"] })
  assert.equal(c.schemaVersion, "gstack.closeout.v1"); assert.equal(c.status, "done")
  assert.equal(c.changedFiles.length, 2)
  const md = renderCloseoutMarkdown(c)
  assert.match(md, /Status: done/); assert.match(md, /Arquivos alterados: 2/)
})

test("runCloseoutSync: grava closeout.json + .md em runs/<runId>", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-")
  try {
    const c = runCloseoutSync({ cwd: dir, runId: "run-x", command: "verify", status: "ready" })
    assert.equal(c.toolsRefresh.state, "not_run", "sem refresh injetado não roda")
    assert.ok(existsSync(path.join(dir, ".gstack", "runs", "run-x", "closeout.json")))
    assert.ok(existsSync(path.join(dir, ".gstack", "runs", "run-x", "closeout.md")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("runCloseoutSync: refresh que quebra → degraded honesto (nunca esconde, nunca lança)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-deg-")
  try {
    const c = runCloseoutSync({ cwd: dir, runId: "r", command: "start", status: "done", refresh: () => { throw new Error("graphify travou") } })
    assert.equal(c.toolsRefresh.state, "degraded")
    assert.match(c.toolsRefresh.error, /graphify travou/)
    const ok = runCloseoutSync({ cwd: dir, runId: "r2", command: "start", status: "done", refresh: () => ({ state: "ok", refreshed: ["graphify"] }) })
    assert.equal(ok.toolsRefresh.state, "ok")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("start: o pipeline grava closeout.json no run (wiring run-loop)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mk("gstack-closeout-start-")
  try {
    const r = await startCommand([], {
      cwd: dir, objective: "criar landing page", projectName: "lp", mode: "lite",
      designSystem: "none", prompt: async () => "lp", select: async (_q, c) => c[0], confirm: async () => true,
      exec: () => ({ ok: true }), gateExec: () => ({ ok: true, code: 0 }),
      devRunner: () => ({ services: [] }), verifyRunner: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
      scoutRunner: () => ({ status: "not_applicable" }),
    })
    assert.equal(r.executed, true)
    const cp = path.join(dir, ".gstack", "runs", r.pipeline.runId, "closeout.json")
    assert.ok(existsSync(cp), "closeout.json escrito pelo pipeline")
    assert.equal(JSON.parse(readFileSync(cp, "utf-8")).command, "start")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
