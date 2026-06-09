import { readFileSync, writeFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import { join, dirname } from "path"

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

export function writeWithBackup(filePath, content) {
  backupFile(filePath)
  ensureDir(dirname(filePath))
  writeFileSync(filePath, content, "utf-8")
}

export function copyWithBackup(src, dst) {
  if (existsSync(dst)) {
    backupFile(dst)
  }
  ensureDir(dirname(dst))
  copyFileSync(src, dst)
}

export function copyDirSync(src, dst) {
  if (existsSync(dst)) {
    backupFile(dst)
  }
  ensureDir(dirname(dst))
  cpSync(src, dst, { recursive: true })
}

export { readJsonFile } from "../harness/detector.js"
