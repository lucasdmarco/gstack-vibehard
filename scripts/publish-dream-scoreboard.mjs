#!/usr/bin/env node
import { appendFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { audit } from "../src/dream/auditor.js"
import { scoreboardFromAudit, renderScoreboardLine } from "../src/dream/scoreboard.js"

/**
 * PRD51 S51.6.1 (ação #2) — publica o placar REAL do commit atual no CI.
 *
 * `dream audit --json` já roda em CI (test-e2e-lifecycle.mjs), mas só para
 * comparar parity de contagens do tarball — o placar nunca era publicado em
 * lugar nenhum. Este script gera o placar do commit e escreve no
 * GITHUB_STEP_SUMMARY (visível na aba Actions da run), nunca um número
 * fixo em doc.
 */
function resolveHeadCommit(cwd) {
  try { return String(execFileSync("git", ["rev-parse", "HEAD"], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 20000 }) || "").trim() || null }
  catch { return null }
}

/** @param {{cwd?:string, auditFn?:Function}} [opts] @returns {string} markdown summary */
export function buildScoreboardSummary(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const result = (opts.auditFn || audit)({ root: cwd, behavioral: true })
  const scoreboard = scoreboardFromAudit(result, { commit: resolveHeadCommit(cwd) })
  return [
    "## Dream Scoreboard",
    "",
    renderScoreboardLine(scoreboard),
    "",
    "_Derivado do auditor real deste commit (`dream audit --json`) — nunca um número fixo._",
    "",
  ].join("\n")
}

// CLI (não executa quando importado em teste)
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href
if (isMain) {
  const summary = buildScoreboardSummary()
  const target = process.env.GITHUB_STEP_SUMMARY
  if (target) appendFileSync(target, summary + "\n")
  console.log(summary)
}
