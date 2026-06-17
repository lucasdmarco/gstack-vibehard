import { existsSync, readFileSync, writeFileSync, copyFileSync, statSync, renameSync, mkdirSync, readdirSync } from "fs"
import { createHash } from "crypto"
import { homedir } from "os"
import { join, dirname } from "path"
import { loadManifest, recordItem, saveManifest } from "./manifest.js"

/**
 * Camada ÚNICA de escrita global segura (PRD faseprebuilt). Toda alteração fora
 * do projeto deve passar por aqui: backup obrigatório (versionado), escrita
 * atômica, hashes e registro no manifest. Falha no backup BLOQUEIA a escrita.
 */

export function sha256(buf) {
  return "sha256:" + createHash("sha256").update(buf).digest("hex")
}

/**
 * Backup versionado: 1º vira `<arquivo>.gstack_vibehard.bak`; se já existir,
 * cria `.bak.1`, `.bak.2`… sem NUNCA sobrescrever um backup anterior.
 */
export function versionedBackup(filePath) {
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) return null
  const base = filePath + ".gstack_vibehard.bak"
  let bak = base
  if (existsSync(bak)) {
    let n = 1
    while (existsSync(`${base}.${n}`)) n++
    bak = `${base}.${n}`
  }
  copyFileSync(filePath, bak)
  return bak
}

function atomicWrite(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.gstack-tmp-${process.pid}`
  writeFileSync(tmp, content)
  renameSync(tmp, filePath)
}

/**
 * Escreve um arquivo global de forma segura e registra no manifest.
 * @returns {{ backup, originalHash, installedHash }}
 */
export function safeWriteFile(filePath, content, opts = {}) {
  const home = opts.home || homedir()
  const existed = existsSync(filePath)
  const originalHash = existed ? sha256(readFileSync(filePath)) : null
  let backup = null
  if (existed) {
    backup = versionedBackup(filePath)
    if (!backup) throw new Error(`safeWriteFile: backup obrigatório falhou para ${filePath}`)
  }
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content))
  atomicWrite(filePath, buf)
  const installedHash = sha256(buf)
  const manifest = loadManifest(home)
  recordItem(manifest, {
    path: filePath,
    kind: opts.kind || "config",
    action: opts.action || (existed ? "modified" : "created"),
    component: opts.component || "unknown",
    backup,
    originalHash,
    installedHash,
    // arquivo que JÁ existia (do usuário) não é removido no uninstall — é restaurado.
    removeOnUninstall: opts.removeOnUninstall != null ? opts.removeOnUninstall : !existed,
    restoreOnUninstall: !!backup,
  })
  saveManifest(manifest, home)
  return { backup, originalHash, installedHash }
}

export function safeCopyFile(src, dst, opts = {}) {
  return safeWriteFile(dst, readFileSync(src), { kind: "file", ...opts })
}

/** Copia um diretório recursivamente e registra o DIR no manifest (1 item). */
export function safeCopyDir(src, dst, opts = {}) {
  const home = opts.home || homedir()
  const existed = existsSync(dst)
  mkdirSync(dst, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) safeCopyDir(s, d, { ...opts, _skipRecord: true })
    else copyFileSync(s, d)
  }
  if (!opts._skipRecord) {
    const manifest = loadManifest(home)
    recordItem(manifest, {
      path: dst,
      kind: opts.kind || "dir",
      action: existed ? "merged" : "created",
      component: opts.component || "unknown",
      backup: null,
      removeOnUninstall: opts.removeOnUninstall != null ? opts.removeOnUninstall : !existed,
      restoreOnUninstall: false,
    })
    saveManifest(manifest, home)
  }
  return { existed }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

/**
 * Insere/atualiza um BLOCO marcado em arquivo compartilhado (.env, CLAUDE.md…).
 * Preserva o conteúdo do usuário fora dos marcadores. Vai pro manifest com
 * `removeOnUninstall:false` (no uninstall só o BLOCO é removido, não o arquivo).
 */
export function safeAppendBlock(filePath, block, opts = {}) {
  const begin = opts.beginMarker
  const end = opts.endMarker
  if (!begin || !end) throw new Error("safeAppendBlock: beginMarker/endMarker obrigatórios")
  const existed = existsSync(filePath)
  const current = existed ? readFileSync(filePath, "utf-8") : ""
  let next
  if (current.includes(begin)) {
    const re = new RegExp(`${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}`)
    next = current.replace(re, `${begin}\n${block}\n${end}`)
  } else {
    next = (current ? current.trimEnd() + "\n\n" : "") + `${begin}\n${block}\n${end}\n`
  }
  return safeWriteFile(filePath, next, { kind: "config", action: "merged", removeOnUninstall: false, ...opts })
}
