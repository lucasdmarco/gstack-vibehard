import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"

/**
 * Manifest como FONTE DE VERDADE do que o gstack instalou (~/.gstack_vibehard/
 * install-manifest.json). O uninstall só remove/restaura itens aqui registrados —
 * é assim que garantimos "nunca apagar arquivo/skill do usuário" SEM precisar
 * renomear nada para `g_` (ownership por manifest).
 *
 * Backward-compatible: preserva chaves antigas (agentDirectories, agentmemory…)
 * e adiciona o array `items`.
 */

export function manifestPath(home = homedir()) {
  return join(home, ".gstack_vibehard", "install-manifest.json")
}

export function freshManifest() {
  return {
    version: 1,
    installedAt: new Date().toISOString(),
    packageVersion: "",
    items: [],
    rollback: { available: true, backupCount: 0 },
  }
}

export function loadManifest(home = homedir()) {
  const p = manifestPath(home)
  if (existsSync(p)) {
    try {
      const m = JSON.parse(readFileSync(p, "utf-8"))
      if (!Array.isArray(m.items)) m.items = []
      if (!m.rollback) m.rollback = { available: true, backupCount: 0 }
      return m
    } catch { /* corrompido → começa limpo, sem perder o arquivo (não sobrescreve aqui) */ }
  }
  return freshManifest()
}

/** Registra (ou atualiza por path+kind) um item de instalação. */
export function recordItem(manifest, item) {
  manifest.items = manifest.items || []
  const norm = {
    owner: "gstack",
    createdAt: new Date().toISOString(),
    removeOnUninstall: item.removeOnUninstall !== false,
    restoreOnUninstall: !!item.backup,
    ...item,
  }
  const i = manifest.items.findIndex((x) => x.path === norm.path && x.kind === norm.kind)
  if (i >= 0) manifest.items[i] = norm
  else manifest.items.push(norm)
  manifest.rollback = manifest.rollback || { available: true, backupCount: 0 }
  manifest.rollback.backupCount = manifest.items.filter((x) => x.backup).length
  return norm
}

export function saveManifest(manifest, home = homedir()) {
  const p = manifestPath(home)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n")
  return p
}

export function findItems(manifest, pred) {
  return (manifest.items || []).filter(pred)
}
