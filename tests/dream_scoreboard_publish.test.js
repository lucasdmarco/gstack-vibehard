import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "scripts", "publish-dream-scoreboard.mjs")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

/**
 * PRD51 S51.6.1 (ação #2) — CI já rodava `dream audit --json` só pra parity
 * de tarball; nunca publicava o placar em lugar nenhum. Este script gera o
 * markdown que a nova job `dream-scoreboard` escreve no GITHUB_STEP_SUMMARY.
 */

test("buildScoreboardSummary: nunca contém número fixo — sempre deriva do auditFn injetado, com proveniência", async () => {
  const { buildScoreboardSummary } = await imp()
  const fakeAudit = () => ({ summary: { REAL: 2, NOT_PROVED: 5 }, scope: { headCommit: "abc123def456" } })
  const out = buildScoreboardSummary({ cwd: repoRoot, auditFn: fakeAudit })
  assert.match(out, /## Dream Scoreboard/)
  assert.match(out, /2 REAL \/ 5 NOT_PROVED/)
  assert.match(out, /abc123d/, "proveniência do commit aparece (7 chars)")
  assert.match(out, /nunca um número fixo/)
})

test("buildScoreboardSummary: com o auditor REAL (sem injeção) produz um placar válido do repo atual", async () => {
  const { buildScoreboardSummary } = await imp()
  const out = buildScoreboardSummary({ cwd: repoRoot })
  assert.match(out, /## Dream Scoreboard/)
  assert.match(out, /REAL/)
})
