import { loadRuntimeManifest, validateRuntimeManifest } from "../runtime/manifest.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `runtime` (PRD 12 PR3): por ora só `status` — lê e VALIDA o Runtime Manifest V2
 * declarado (o que `dev` vai subir). O supervisor (dev/stop/logs/open) é o PR4 e
 * responde honestamente como `pending_feature` até lá.
 */
export async function runtimeCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-")) || "status"

  if (sub === "status") {
    const m = loadRuntimeManifest(cwd)
    if (!m) {
      if (json) { process.stdout.write(JSON.stringify({ ok: false, error: "sem .gstack/runtime.json ou services.json" }) + "\n"); return }
      warn("Sem manifest de runtime neste diretório — rode dentro de um projeto criado com `gstack_vibehard create`.")
      return
    }
    const v = validateRuntimeManifest(m)
    if (json) {
      process.stdout.write(JSON.stringify({ schemaVersion: m.schemaVersion, valid: v.valid, errors: v.errors, services: m.services }) + "\n")
      if (opts.strict && !v.valid) process.exitCode = 1
      return
    }
    section(`runtime status — manifest v${m.schemaVersion} ${v.valid ? "(válido)" : "(INVÁLIDO)"}`)
    for (const s of m.services || []) {
      const port = s.port ? `:${s.port.preferred}${s.port.autoAllocate ? " (auto)" : ""}` : "(sem porta)"
      const hp = s.health && s.health.readiness && s.health.readiness.path ? ` · health ${s.health.readiness.path}` : ""
      info(`  • ${s.name} ${port} — ${(s.command || []).join(" ")}${hp}`)
      if (s.dependsOn && s.dependsOn.length) info(`      dependsOn: ${s.dependsOn.join(", ")}`)
    }
    if (!v.valid) { v.errors.forEach((e) => warn(`  ✗ ${e}`)); error("Manifest de runtime INVÁLIDO."); return }
    info("")
    info("  (declarado; `gstack_vibehard dev` sobe os serviços — supervisor em construção, PRD 12 PR4.)")
    success("Runtime declarado e válido.")
    return
  }

  if (["dev", "stop", "restart", "logs", "open"].includes(sub)) {
    if (json) { process.stdout.write(JSON.stringify({ status: "pending_feature", command: sub }) + "\n"); return }
    warn(`\`runtime ${sub}\`: supervisor em construção (PRD 12 PR4). Por ora, \`runtime status\` mostra o que vai subir.`)
    return
  }

  warn(`runtime: subcomando '${sub}' desconhecido. Use: status (dev/stop/logs/open chegam no PR4).`)
}
