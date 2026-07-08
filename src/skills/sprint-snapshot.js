import { writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { buildCloseout } from "./closeout.js"

/**
 * Sprint Closeout Snapshot (PRD28 28.8 / PRD34 F4-B).
 *
 * `sprint --save` grava um snapshot legível da sprint em `.gstack/sprints/<id>/`:
 * `summary.md` (resumo + próxima-sessão-leia-primeiro) e `closeout.json` (reusa o
 * contrato de closeout F4-A). Declara o estado do grafo (fresh/stale com ação) para
 * a próxima sessão não herdar um grafo desatualizado. PURO/testável.
 */

export const SPRINT_SNAPSHOT_SCHEMA = "gstack.sprint-snapshot.v1"

const defaultIo = Object.freeze({
  write: (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s) },
})

export function buildSprintSnapshot({ sprintId, summary = "", changed = [], graphState = "unknown", nextReadFirst = [] } = {}) {
  return {
    schemaVersion: SPRINT_SNAPSHOT_SCHEMA, generatedAt: new Date().toISOString(),
    sprintId: sprintId ?? null, summary, changedFiles: [...changed], graphState,
    graphAction: graphState === "fresh" ? null : "rode `graphify update .` antes de continuar (grafo pode estar stale)",
    nextSession: { readFirst: [...nextReadFirst] },
  }
}

export function renderSprintSummaryMarkdown(s) {
  return [
    `# Sprint ${s.sprintId}`, "", s.summary || "(sem resumo)", "",
    `Grafo: ${s.graphState}${s.graphAction ? ` — ${s.graphAction}` : ""}`,
    `Arquivos alterados: ${s.changedFiles.length}`,
    ...s.changedFiles.slice(0, 30).map((f) => `- ${f}`), "",
    "## Próxima sessão — leia primeiro", ...s.nextSession.readFirst.map((f) => `- ${f}`), "",
  ].join("\n")
}

export function writeSprintSnapshot({ cwd, sprintId, snapshot, io = defaultIo }) {
  const dir = join(cwd, ".gstack", "sprints", sprintId)
  io.write(join(dir, "summary.md"), renderSprintSummaryMarkdown(snapshot))
  const closeout = buildCloseout({ runId: sprintId, command: "sprint", status: "saved", changed: snapshot.changedFiles })
  io.write(join(dir, "closeout.json"), JSON.stringify({ ...closeout, sprintSnapshot: snapshot }, null, 2) + "\n")
  return dir
}

/** Orquestra o snapshot: id default por timestamp; nextReadFirst padrão. */
export function saveSprintSnapshot({ cwd, sprintId = null, summary = "", changed = [], graphState = "unknown", io = defaultIo } = {}) {
  const id = sprintId || `sprint-${new Date().toISOString().replace(/[:.]/g, "-")}`
  const snapshot = buildSprintSnapshot({
    sprintId: id, summary, changed, graphState,
    nextReadFirst: ["CHANGELOG.md", `.gstack/sprints/${id}/summary.md`],
  })
  const dir = writeSprintSnapshot({ cwd, sprintId: id, snapshot, io })
  return { sprintId: id, dir, snapshot }
}
