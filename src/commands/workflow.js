import { existsSync } from "fs"
import { join } from "path"
import { execFileSync as defaultExecFileSync } from "child_process"
import { runWorkflow } from "../workflow-graph/runner.js"
import { listRuns, runStats, readJournal } from "../workflow-graph/journal.js"
import { normalizeLoopBudget } from "../loop-budget/policy.js"
import { readJsonFile } from "../installer/merge.js"
import { success, warn, error, info, section } from "../cli/index.js"

function journalBaseFor(cwd) {
  return join(cwd, ".gstack", "workflows", "runs")
}

function loadBudget(cwd) {
  const f = join(cwd, ".gstack", "loop-budget.json")
  return normalizeLoopBudget(readJsonFile(f) || {})
}

/** Verifier DETERMINÍSTICO: roda a suíte de testes do projeto (exit code). */
function makeTestVerifier(cwd, exec = defaultExecFileSync) {
  return () => {
    let argv = null
    if (existsSync(join(cwd, "package.json"))) {
      const isWin = process.platform === "win32"
      argv = isWin ? { file: "cmd.exe", args: ["/c", "npm", "test", "--silent"] } : { file: "npm", args: ["test", "--silent"] }
    } else if (existsSync(join(cwd, "tests")) || existsSync(join(cwd, "pytest.ini"))) {
      argv = { file: process.platform === "win32" ? "python" : "python3", args: ["-m", "pytest", "-q"] }
    } else {
      return { passed: false, signature: "no_tests", detail: "sem suíte de testes detectada" }
    }
    try {
      exec(argv.file, argv.args, { cwd, stdio: "pipe", shell: false, timeout: 300000 })
      return { passed: true, signature: "tests_passed" }
    } catch (e) {
      return { passed: false, signature: "tests_failed", detail: (e.message || "").slice(0, 120) }
    }
  }
}

function parseFlags(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--task") out.task = args[++i]
    else if (a === "--max-iterations") out.maxIterations = parseInt(args[++i], 10)
    else if (a === "--run-id") out.runId = args[++i]
    else if (a === "--json") out.json = true
    else out._.push(a)
  }
  return out
}

export async function workflowCommand(args = [], opts = {}) {
  const sub = args[0]
  const cwd = opts.cwd || process.cwd()
  const base = journalBaseFor(cwd)

  switch (sub) {
    case "run": {
      const flags = parseFlags(args.slice(1))
      section(`workflow run — ${flags.task || "(sem task)"}`)
      if (!flags.task) { error("Forneça --task \"...\""); return }
      const budget = loadBudget(cwd)
      if (flags.maxIterations) budget.maxIterations = flags.maxIterations

      const verifier = opts.verifier || makeTestVerifier(cwd, opts.exec)
      const result = runWorkflow({
        task: flags.task, cwd, budget, journalBase: base,
        worker: opts.worker, verifier, exec: opts.exec, runId: opts.runId || flags.runId,
      })
      if (result.resumed) info("(run retomado do journal)")

      const icon = result.status === "passed" ? "✓" : result.status === "handoff" ? "⚠" : "✗"
      info(`${icon} run ${result.runId}: ${result.status} em ${result.iterations} iteração(ões)`)
      if (result.status === "handoff") warn("Circuit breaker — HUMAN HANDOFF: revise antes de re-tentar.")
      if (result.status === "passed") success("Verificação passou.")
      if (result.warning) warn(result.warning)
      return result
    }

    case "runs": {
      section("workflow runs")
      const runs = listRuns(base)
      if (runs.length === 0) { info("  (nenhum run)"); return }
      for (const r of runs) {
        const s = runStats(base, r)
        info(`  ${r} — completed:${s.completed} failed:${s.failed} hits:${s.journalHits}`)
      }
      return
    }

    case "inspect": {
      const flags = parseFlags(args.slice(1))
      const runId = flags._[0] || args[1]
      // Valida runId ANTES de tocar o disco (readJournal exige string).
      if (!runId) {
        if (flags.json) { process.stdout.write(JSON.stringify({ error: "missing runId" }) + "\n"); return }
        section("workflow inspect")
        error("Forneça <runId>")
        return
      }
      const evs = readJournal(base, runId)
      if (flags.json) {
        // Saída JSON para automação (inspect --json)
        process.stdout.write(JSON.stringify({ runId, stats: runStats(base, runId), events: evs }, null, 2) + "\n")
        return { runId, events: evs }
      }
      section(`workflow inspect ${runId}`)
      if (evs.length === 0) { warn("Run não encontrado ou vazio."); return }
      for (const e of evs) info(`  ${e.ts} ${e.event}${e.nodeId ? " " + e.nodeId : ""}${e.signature ? " [" + e.signature + "]" : ""}`)
      return
    }

    default:
      section("workflow — graph runner determinístico")
      info("  gstack_vibehard workflow run --task \"...\" [--max-iterations N]")
      info("  gstack_vibehard workflow runs                Listar runs")
      info("  gstack_vibehard workflow inspect <runId>     Ver eventos do journal")
  }
}
