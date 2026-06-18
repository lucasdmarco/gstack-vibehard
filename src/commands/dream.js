import { audit } from "../dream/auditor.js"
import { HARNESS_CAPABILITIES } from "../dream/capabilities.js"
import { success, warn, error, info, section } from "../cli/index.js"

/**
 * `dream` — capacidade de auto-melhoria. Fase 3 entrega o ANTI-PLACEBO read-only:
 *   dream audit   → classifica promessas (REAL/PARTIAL/PLACEBO/ROADMAP/RISK)
 *   dream status  → resumo + matriz de capacidades por harness
 * plan/improve/accept/reject chegam na fatia seguinte (honesto: não fingem existir).
 */
export async function dreamCommand(args = [], opts = {}) {
  const sub = args.find((a) => !a.startsWith("--")) || "status"
  const json = args.includes("--json")
  const root = opts.root

  if (sub === "audit") {
    const r = audit({ root })
    if (json) { process.stdout.write(JSON.stringify(r) + "\n"); return r }
    section("dream audit — promessas vs evidência (determinístico, sem LLM)")
    for (const c of r.claims) {
      const icon = c.status === "REAL" ? "✓" : c.status === "RISK" ? "⚠" : c.status === "PLACEBO" ? "✗" : "•"
      info(`  ${icon} [${c.status}/${c.severity}] ${c.claim}`)
      if (c.missing.length) c.missing.forEach((m) => info(`        falta: ${m}`))
    }
    info("")
    info(`  Resumo: ${Object.entries(r.summary).map(([k, v]) => `${k}:${v}`).join(" · ")}`)
    return r
  }

  if (["plan", "improve", "inspect", "accept", "reject"].includes(sub)) {
    if (json) { process.stdout.write(JSON.stringify({ error: "not_implemented", subcommand: sub, note: "dream plan/improve chegam na próxima fatia" }) + "\n"); return }
    section(`dream ${sub}`)
    warn("Ainda não implementado (honesto). Esta fatia entregou `dream audit` + matriz de capacidades.")
    info("Próxima fatia: dream plan → improve (adapter local, worktree+verify) → accept/reject.")
    return
  }

  // status (default)
  if (json) { process.stdout.write(JSON.stringify({ audit: audit({ root }).summary, harnesses: HARNESS_CAPABILITIES }) + "\n"); return }
  section("dream status")
  const r = audit({ root })
  info("  Modo: AUDIT ON (read-only) · auto-IMPROVE no roadmap (worktree/verify/accept-reject — ainda não executável)")
  info(`  Audit: ${Object.entries(r.summary).map(([k, v]) => `${k}:${v}`).join(" · ")}`)
  info("  Confiança por harness (matriz de capacidades):")
  for (const c of Object.values(HARNESS_CAPABILITIES)) {
    const t = c.trustLevel === "strong" ? "✓ forte" : c.trustLevel === "partial" ? "~ parcial" : "⚠ best-effort"
    info(`    ${c.id}: ${c.mode} — ${t}`)
  }
  if (r.summary.RISK > 0) warn(`${r.summary.RISK} claim(s) RISK — rode \`dream audit\` para detalhes.`)
  else success("Sem claims RISK no momento.")
  return r
}
