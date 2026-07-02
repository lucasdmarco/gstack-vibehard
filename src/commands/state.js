import { openStateStore } from "../state/store.js"
import { section, info } from "../cli/index.js"

/**
 * `state summary [--json]` — resumo do State Store operacional do projeto
 * (PRD14 §4.4): backend em uso, arquivo e contagem/último evento por entidade.
 * Export JSON pensado para o dashboard futuro.
 */
export function stateCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const store = openStateStore(cwd, opts)
  const summary = store.summary()
  store.close()
  if (json) { process.stdout.write(JSON.stringify(summary) + "\n"); return summary }
  section("state summary — store operacional do projeto")
  info(`  Backend: ${summary.backend} · arquivo: ${summary.file} · schema v${summary.schemaVersion}`)
  for (const [entity, c] of Object.entries(summary.entities)) {
    info(`  • ${entity}: ${c.count} evento(s)${c.lastAt ? ` · último: ${c.lastAt}` : ""}`)
  }
  if (summary.backend === "jsonl_fallback") info("  Nota: Node sem sqlite nativo — fallback JSONL declarado (mesma API).")
  return summary
}
