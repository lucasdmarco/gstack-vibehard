import { publishGuard } from "../project-plan/publish-guard.js"
import { success, warn, error, info, section } from "../cli/index.js"

/**
 * `publish-guard` — check determinístico de checkpoint antes de publicar.
 *   gstack_vibehard publish-guard [--json] [--no-ci]
 * Exit ≠0 quando há pendência HARD (tree suja, sem bump, CHANGELOG sem entrada).
 */
export async function publishGuardCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const checkCi = !args.includes("--no-ci")
  const report = publishGuard({ cwd, exec: opts.exec, checkCi })

  if (json) { process.stdout.write(JSON.stringify(report) + "\n"); return report }

  section(`publish-guard — v${report.version || "?"} · ${report.status === "pass" ? "PRONTO" : "PENDENTE"}`)
  for (const c of report.checks) {
    const icon = c.status === "passed" ? "✓" : c.status === "failed" ? "✗" : c.status === "warning" ? "•" : "–"
    const fn = c.status === "failed" ? error : c.status === "warning" ? warn : info
    fn(`  ${icon} ${c.id}: ${c.detail}`)
  }
  if (report.status === "pass") success("Pronto para publicar (checks obrigatórios OK).")
  else { error(`BLOQUEADO p/ publicar — pendências: ${report.failed.join(", ")}`); if (!opts.noExit) process.exitCode = 1 }
  return report
}
