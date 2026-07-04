import { existsSync, readFileSync, copyFileSync } from "fs"
import { createHash } from "crypto"
import { loadManifest, findItems } from "./manifest.js"

/**
 * Núcleo de RESTORE do uninstall, extraído para ser injetável por `home` (o
 * uninstall real usa `HOME`; o Clean-Machine Proof Pack roda o MESMO código
 * contra uma home-fixture). Restaura SEMPRE o ORIGINAL do usuário (o primeiro
 * `.gstack_vibehard.bak`, que `versionedBackup` nunca sobrescreve) — caindo pro
 * `item.backup` só se preciso. Drift-safe (AC7): se o arquivo atual difere do que
 * o gstack instalou, o usuário o editou DEPOIS — não sobrescreve sem `--resolve-drift`.
 */

function sha256(buf) { return "sha256:" + createHash("sha256").update(buf).digest("hex") }

// Fonte do backup: prefere o `.gstack_vibehard.bak` (original do usuário) ao item.backup.
function backupSource(it) {
  const original = it.path + ".gstack_vibehard.bak"
  if (existsSync(original)) return original
  return it.backup && existsSync(it.backup) ? it.backup : null
}

// true = restore deve ser PULADO por drift (arquivo editado após a instalação).
function driftBlocks(it, resolveDrift) {
  if (!it.installedHash || resolveDrift || !existsSync(it.path)) return false
  try { return sha256(readFileSync(it.path)) !== it.installedHash }
  catch { return false } // ilegível → conservador, segue e tenta restaurar
}

function restoreOne(it, report, opts) {
  const src = backupSource(it)
  if (!src) { report.skipped.push(`restore: sem backup p/ ${it.path}`); return }
  if (driftBlocks(it, opts.resolveDrift)) {
    report.skipped.push(`restore PULADO — ${it.path} foi editado após a instalação. Backup preservado em ${src}. Force com \`--resolve-drift\` (ou compare manualmente).`)
    return
  }
  if (opts.dryRun) { report.restored.push(`(dry-run) ${it.path} ← ${src}`); return }
  try {
    copyFileSync(src, it.path)
    report.restored.push(`${it.path} (de ${src})`)
  } catch (e) {
    report.errors.push(`restore ${it.path}: ${e.message}`)
  }
}

/** Restaura todos os itens `restoreOnUninstall` do manifest de `home`. */
export function restoreBackupsFromManifest(home, report, opts = {}) {
  const manifest = loadManifest(home)
  for (const it of findItems(manifest, (x) => x.restoreOnUninstall)) restoreOne(it, report, opts)
  return report
}
