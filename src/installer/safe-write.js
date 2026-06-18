import { existsSync, readFileSync, writeFileSync, copyFileSync, statSync, renameSync, mkdirSync, readdirSync } from "fs"
import { createHash } from "crypto"
import { homedir, tmpdir } from "os"
import { join, dirname } from "path"
import { loadManifest, recordItem, saveManifest } from "./manifest.js"

/**
 * Decide se um caminho deve ser registrado no manifest GLOBAL.
 * Cuidado Windows: `tmpdir()` (AppData\Local\Temp) fica SOB `homedir()`, então
 * `startsWith(home)` sozinho daria true para arquivos temporários de teste —
 * poluindo/corrompendo o manifest real do desenvolvedor. Só registra quando o
 * `home` foi passado explicitamente (intenção do caller/teste) OU o caminho NÃO
 * está sob `tmpdir()`.
 */
export function shouldRecordManifest(filePath, home, explicitHome) {
  if (!filePath.startsWith(home)) return false
  if (explicitHome) return true
  return !filePath.startsWith(tmpdir())
}

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
  // Manifest só registra mudanças GLOBAIS de verdade (ver shouldRecordManifest).
  if (shouldRecordManifest(filePath, home, opts.home != null)) {
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
  }
  return { backup, originalHash, installedHash }
}

export function safeCopyFile(src, dst, opts = {}) {
  return safeWriteFile(dst, readFileSync(src), { kind: "file", ...opts })
}

/** Copia um diretório recursivamente e registra o DIR no manifest (1 item). */
export function safeCopyDir(src, dst, opts = {}) {
  const home = opts.home || homedir()
  const explicitHome = opts.home != null
  const existed = existsSync(dst)
  // Acumula arquivos internos sobrescritos (com backup) p/ registrá-los como
  // RESTAURÁVEIS no manifest — senão o uninstall não restaura o que o usuário tinha.
  const overwritten = opts._overwritten || []
  mkdirSync(dst, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) safeCopyDir(s, d, { ...opts, _skipRecord: true, _overwritten: overwritten })
    else {
      // Backup por arquivo INTERNO: nunca sobrescreve um arquivo do usuário sem
      // preservar o original (versionado) — e marca p/ restauração no manifest.
      if (existsSync(d)) { const bak = versionedBackup(d); if (bak) overwritten.push({ path: d, backup: bak }) }
      copyFileSync(s, d)
    }
  }
  if (!opts._skipRecord && shouldRecordManifest(dst, home, explicitHome)) {
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
    // Cada arquivo interno do USUÁRIO sobrescrito vira item restaurável.
    for (const it of overwritten) {
      recordItem(manifest, {
        path: it.path, kind: "file", action: "modified",
        component: opts.component || "unknown", backup: it.backup,
        removeOnUninstall: false, restoreOnUninstall: true,
      })
    }
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
