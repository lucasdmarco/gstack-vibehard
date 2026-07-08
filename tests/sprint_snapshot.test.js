import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtempSync(path.join(tmpdir(), p))

test("buildSprintSnapshot: fresh sem ação; não-fresh com ação de grafo", async () => {
  const { buildSprintSnapshot } = await imp("src/skills/sprint-snapshot.js")
  assert.equal(buildSprintSnapshot({ sprintId: "s1", graphState: "fresh" }).graphAction, null)
  const stale = buildSprintSnapshot({ sprintId: "s1", graphState: "absent" })
  assert.match(stale.graphAction, /graphify update/)
})

test("renderSprintSummaryMarkdown: inclui grafo, alterados e próxima-sessão", async () => {
  const { buildSprintSnapshot, renderSprintSummaryMarkdown } = await imp("src/skills/sprint-snapshot.js")
  const md = renderSprintSummaryMarkdown(buildSprintSnapshot({ sprintId: "s2", summary: "fez X", changed: ["a.js"], graphState: "fresh", nextReadFirst: ["CHANGELOG.md"] }))
  assert.match(md, /# Sprint s2/); assert.match(md, /leia primeiro/i); assert.match(md, /CHANGELOG\.md/)
})

test("saveSprintSnapshot: grava summary.md + closeout.json em .gstack/sprints/<id>", async () => {
  const { saveSprintSnapshot } = await imp("src/skills/sprint-snapshot.js")
  const dir = mk("gstack-sprint-")
  try {
    const r = saveSprintSnapshot({ cwd: dir, sprintId: "sprint-1", summary: "closeout", changed: ["x.js"], graphState: "fresh" })
    assert.equal(r.sprintId, "sprint-1")
    assert.ok(existsSync(path.join(dir, ".gstack", "sprints", "sprint-1", "summary.md")))
    const co = JSON.parse(readFileSync(path.join(dir, ".gstack", "sprints", "sprint-1", "closeout.json"), "utf-8"))
    assert.equal(co.schemaVersion, "gstack.closeout.v1"); assert.equal(co.command, "sprint")
    assert.equal(co.sprintSnapshot.schemaVersion, "gstack.sprint-snapshot.v1")
    assert.deepEqual(co.sprintSnapshot.nextSession.readFirst, ["CHANGELOG.md", ".gstack/sprints/sprint-1/summary.md"])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("saveSprintSnapshot: id default por timestamp quando não dado", async () => {
  const { saveSprintSnapshot } = await imp("src/skills/sprint-snapshot.js")
  const dir = mk("gstack-sprint-id-")
  try {
    const r = saveSprintSnapshot({ cwd: dir, summary: "x" })
    assert.match(r.sprintId, /^sprint-/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
