import { readdirSync, statSync } from "fs"
import { join } from "path"
import { preAction, readActions, ACTION_KERNEL_SCHEMA } from "../skills/action-kernel.js"
import { section, success, warn, info, error } from "../cli/index.js"

/**
 * `gstack_vibehard actions <ledger|bench>` (PRD36 36.1).
 *
 * KNOWLEDGE layer: só lê/mede — nunca edita código. `ledger` mostra o
 * `.gstack/runs/<runId>/actions.jsonl` (o que rodou por ação); `bench` PROVA o
 * DoD de p95 < 250ms sem rede rodando o pre-action N vezes.
 */

const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

// Run mais recente sob .gstack/runs (por mtime) — para `ledger` sem --run.
function latestRun(cwd) {
  const runsRoot = join(cwd, ".gstack", "runs")
  let best = null
  try {
    for (const name of readdirSync(runsRoot)) {
      const m = statSync(join(runsRoot, name)).mtimeMs
      if (!best || m > best.m) best = { name, m }
    }
  } catch { /* sem runs ainda */ }
  return best ? best.name : null
}

function ledgerCmd(cwd, args, json) {
  const runId = flagValue(args, "--run") || latestRun(cwd)
  if (!runId) { warn("Nenhum run em .gstack/runs — rode um fluxo antes."); return { runId: null, actions: [] } }
  const actions = readActions({ root: cwd, runId })
  if (json) { process.stdout.write(JSON.stringify({ schemaVersion: ACTION_KERNEL_SCHEMA, runId, actions }) + "\n"); return { runId, actions } }
  section(`actions ledger — run ${runId} (${actions.length} ação/ações)`)
  for (const a of actions) {
    const icon = a.decision === "deny" ? "⛔" : a.decision === "warn" ? "⚠" : "✓"
    info(`  ${icon} ${a.tool || "?"}/${a.harness || "?"} → ${a.decision} · gates: ${(a.gatesExecuted || []).join(", ") || "—"} · exit ${a.exitCode}`)
    for (const r of a.reasons || []) info(`      ${r}`)
  }
  return { runId, actions }
}

// Ação representativa (mistura de checagens) para medir o custo do pre-action.
const BENCH_ACTION = Object.freeze({
  tool: "write", harness: "claude",
  files: ["apps/web/src/components/Card.tsx", "apps/api/routes/users.ts"],
  command: "npm run build",
  writesCode: true,
})
const BENCH_CTX = Object.freeze({ root: process.cwd(), planApproved: false, designResolved: true })

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function benchCmd(args, json) {
  const iters = Math.max(20, Number(flagValue(args, "--iters")) || 200)
  const samples = []
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now()
    preAction(BENCH_ACTION, BENCH_CTX)
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const round = (n) => Number(n.toFixed(4))
  const report = {
    schemaVersion: ACTION_KERNEL_SCHEMA, iters,
    p50: round(percentile(samples, 50)), p95: round(percentile(samples, 95)),
    p99: round(percentile(samples, 99)), max: round(samples[samples.length - 1]),
    budgetMs: 250, network: false,
    ok: percentile(samples, 95) < 250,
  }
  if (json) { process.stdout.write(JSON.stringify(report) + "\n"); if (!report.ok) process.exitCode = 1; return report }
  section(`actions bench — pre-action ${iters}×`)
  info(`  p50 ${report.p50}ms · p95 ${report.p95}ms · p99 ${report.p99}ms · max ${report.max}ms (budget ${report.budgetMs}ms, sem rede)`)
  if (report.ok) success("p95 dentro do budget (< 250ms) — kernel bounded")
  else { error(`p95 ${report.p95}ms ESTOUROU o budget de 250ms`); process.exitCode = 1 }
  return report
}

function printUsage() {
  section("actions")
  info("  actions ledger [--run <id>] [--json]   mostra .gstack/runs/<runId>/actions.jsonl (o que rodou por ação)")
  info("  actions bench [--iters N] [--json]     prova o DoD: pre-action p95 < 250ms sem rede")
}

const SUBCOMMANDS = Object.freeze({
  ledger: (cwd, args, json) => ledgerCmd(cwd, args, json),
  bench: (cwd, args, json) => benchCmd(args, json),
})

export async function actionsCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json)
  return printUsage()
}
