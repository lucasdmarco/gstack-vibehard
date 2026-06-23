import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { createHash } from "crypto"
import { manifestPath, loadManifest, saveManifest } from "./manifest.js"
import { versionedBackup } from "./safe-write.js"

function sha256(buf) { return "sha256:" + createHash("sha256").update(buf).digest("hex") }

/**
 * Repara/migra um manifest inseguro SEM destruir backups do usuário:
 *  - **poda** entradas cujo arquivo rastreado sumiu (nada a desinstalar);
 *  - **marca não-restaurável** a entrada cujo backup não existe mais (mantém a
 *    entrada; NUNCA apaga backups);
 *  - **reporta** (sem tocar) config JSON inválido e drift de conteúdo;
 *  - **normaliza** schema legado (campo `version`).
 *
 * `dryRun` é o default seguro: só calcula o plano, não escreve nada (PURO).
 * Ao aplicar, faz BACKUP versionado do próprio manifest antes de reescrever.
 *
 * @param {string} [home]
 * @param {{ dryRun?: boolean }} [opts]
 */
export function repairManifest(home = homedir(), opts = {}) {
  const dryRun = opts.dryRun !== false // default = dry-run
  const p = manifestPath(home)
  if (!existsSync(p)) {
    return { manifestExists: false, applied: false, dryRun, plan: [], backup: null,
      note: "manifest ausente — nada a reparar (instale com `gstack_vibehard install`)." }
  }
  const manifest = loadManifest(home)
  const items = manifest.items || []
  const plan = []
  const kept = []

  for (const it of items) {
    // 1) entrada morta: arquivo rastreado sumiu → nada a desinstalar → podar
    if (it.kind !== "dir" && it.removeOnUninstall && it.path && !existsSync(it.path)) {
      plan.push({ action: "prune", path: it.path, reason: "arquivo rastreado ausente (nada a desinstalar)" })
      continue
    }
    // 2) backup sumiu → não dá pra restaurar → marca não-restaurável (mantém; NUNCA apaga backup)
    if (it.restoreOnUninstall && it.backup && !existsSync(it.backup)) {
      plan.push({ action: "mark-unrestorable", path: it.path, reason: `backup ausente (${it.backup}) — entrada marcada não-restaurável` })
      kept.push({ ...it, restoreOnUninstall: false })
      continue
    }
    // 3) config JSON inválido → só reporta (arquivo do usuário, não tocar)
    if (it.kind !== "dir" && it.path && it.path.endsWith(".json") && existsSync(it.path)) {
      try { JSON.parse(readFileSync(it.path, "utf-8")) }
      catch { plan.push({ action: "report", path: it.path, reason: "config JSON inválido (não alterado — verifique manualmente)" }) }
    }
    // 4) drift de conteúdo → só reporta (preserva o que você editou)
    if (it.kind !== "dir" && it.installedHash && it.path && existsSync(it.path)) {
      try { if (sha256(readFileSync(it.path)) !== it.installedHash) plan.push({ action: "report", path: it.path, reason: "drift: conteúdo difere do instalado (preservado)" }) }
      catch { /* ignore leitura */ }
    }
    kept.push(it)
  }

  // 5) schema legado sem `version`
  const schemaFix = !manifest.version
  if (schemaFix) plan.push({ action: "migrate", path: p, reason: "schema sem `version` → normalizado para 1" })

  const mutating = plan.filter((x) => x.action === "prune" || x.action === "mark-unrestorable" || x.action === "migrate").length
  let backup = null
  if (!dryRun && mutating > 0) {
    backup = versionedBackup(p) // backup do próprio manifest antes de reescrever
    manifest.items = kept
    if (schemaFix) manifest.version = 1
    manifest.rollback = manifest.rollback || { available: true, backupCount: 0 }
    manifest.rollback.backupCount = kept.filter((x) => x.backup).length
    saveManifest(manifest, home)
  }

  return {
    manifestExists: true,
    applied: !dryRun && mutating > 0,
    dryRun,
    backup,
    plan,
    mutating,
    before: { items: items.length },
    after: { items: kept.length },
  }
}
