import { readFileSync, writeFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import { join, dirname } from "path"
import { safeWriteFile, safeCopyFile, safeCopyDir } from "./safe-write.js"

/** Infere o componente do manifest a partir do caminho global (ownership). */
function inferComponent(p) {
  const s = String(p)
  if (s.includes(".hermes")) return "hermes"
  if (s.includes("opencode")) return "opencode"
  if (s.includes(".codex")) return "codex"
  if (s.includes(".claude") || s.endsWith("CLAUDE.md")) return "claude"
  if (s.includes(".cursor")) return "cursor"
  if (s.endsWith(".mcp.json")) return "mcp"
  if (s.includes("gstack-vault")) return "vault"
  return "config"
}

/**
 * Non-destructive merge engine.
 * - Reads existing config
 * - Merges with GStack rules
 * - Creates .bak backup before any write
 * - User rules take priority on conflict
 */

export function backupFile(filePath) {
  if (!existsSync(filePath)) return false
  if (statSync(filePath).isDirectory()) return false
  const bakPath = filePath + ".gstack_vibehard.bak"
  if (!existsSync(bakPath)) {
    copyFileSync(filePath, bakPath)
  }
  return true
}

export function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export function deepMerge(target, source) {
  const output = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (key in output) {
      if (Array.isArray(output[key]) && Array.isArray(value)) {
        // Copia antes de mutar — nao alterar o array do objeto de entrada
        const merged = [...output[key]]
        const existingSet = new Set(merged)
        for (const item of value) {
          if (!existingSet.has(item)) {
            merged.push(item)
          }
        }
        output[key] = merged
      } else if (typeof output[key] === "object" && typeof value === "object" && !Array.isArray(output[key])) {
        output[key] = deepMerge(output[key], value)
      } else {
        output[key] = value
      }
    } else {
      output[key] = value
    }
  }
  return output
}

export function mergeJson(existing, gvConfig) {
  if (!existing) return gvConfig
  return deepMerge(existing, gvConfig)
}

// Toda escrita/cópia global passa pela camada segura (backup versionado + manifest).
// Mantém a mesma assinatura — migra claude/codex/headroom/etc. sem reescrever callers.
export function writeWithBackup(filePath, content) {
  safeWriteFile(filePath, content, { component: inferComponent(filePath), kind: "config" })
}

export function copyWithBackup(src, dst) {
  safeCopyFile(src, dst, { component: inferComponent(dst), kind: "file" })
}

export function copyDirSync(src, dst) {
  safeCopyDir(src, dst, { component: inferComponent(dst), kind: "dir" })
}

export { readJsonFile } from "../harness/detector.js"
