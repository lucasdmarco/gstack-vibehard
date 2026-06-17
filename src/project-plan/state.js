import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

/**
 * Estado do plano em .gstack/plans/<planId>/status.json:
 *   { id, status, steps: { <stepId>: "completed"|"failed"|"skipped" }, updatedAt }
 * Fonte de verdade para `plan status` (não precisa reparsear o journal bruto).
 */

export function statePath(planDir) {
  return join(planDir, "status.json")
}

export function readState(planDir) {
  const p = statePath(planDir)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null }
}

export function writeState(planDir, state) {
  mkdirSync(planDir, { recursive: true })
  writeFileSync(statePath(planDir), JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + "\n")
}

export function setStepStatus(planDir, stepId, status) {
  const cur = readState(planDir) || { id: "", status: "running", steps: {} }
  cur.steps = cur.steps || {}
  cur.steps[stepId] = status
  writeState(planDir, cur)
  return cur
}

export function setPlanStatus(planDir, planId, status) {
  const cur = readState(planDir) || { id: planId, steps: {} }
  cur.id = planId
  cur.status = status
  writeState(planDir, cur)
  return cur
}
