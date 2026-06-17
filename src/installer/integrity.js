import { existsSync, readFileSync } from "fs"
import { createHash } from "crypto"
import { homedir } from "os"
import { loadManifest, manifestPath } from "./manifest.js"

/**
 * Integridade da instalação (PRD faseprebuilt R8): valida manifest, backups,
 * hashes (drift), arquivos presentes e configs parseáveis. Diz se o uninstall
 * seria seguro. PURO/somente-leitura.
 */
function sha256(buf) { return "sha256:" + createHash("sha256").update(buf).digest("hex") }

export function checkInstallIntegrity(home = homedir()) {
  const p = manifestPath(home)
  if (!existsSync(p)) {
    return { manifestExists: false, items: 0, backupsOk: 0, drift: 0, issues: ["manifest ausente — instalação antiga ou nunca instalado"], safeToUninstall: false }
  }
  const manifest = loadManifest(home)
  const items = manifest.items || []
  const issues = []
  let backupsOk = 0
  let drift = 0
  for (const it of items) {
    if (it.restoreOnUninstall && it.backup) {
      if (!existsSync(it.backup)) issues.push(`backup ausente: ${it.backup}`)
      else backupsOk++
    }
    if (it.kind !== "dir" && existsSync(it.path)) {
      if (it.installedHash) {
        try { if (sha256(readFileSync(it.path)) !== it.installedHash) drift++ } catch { /* ignore */ }
      }
      if (it.path.endsWith(".json")) {
        try { JSON.parse(readFileSync(it.path, "utf-8")) } catch { issues.push(`config JSON inválido: ${it.path}`) }
      }
    } else if (it.kind !== "dir" && it.removeOnUninstall && !existsSync(it.path)) {
      issues.push(`item registrado ausente: ${it.path}`)
    }
  }
  return { manifestExists: true, items: items.length, backupsOk, drift, issues, safeToUninstall: issues.length === 0 }
}
