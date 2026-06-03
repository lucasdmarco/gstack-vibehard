import { readFileSync, writeFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from "fs"
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

export function mergeJson(existing, gvConfig) {
  if (!existing) return gvConfig
  const merged = { ...existing }
  for (const [key, value] of Object.entries(gvConfig)) {
    if (key in merged) {
      if (Array.isArray(merged[key]) && Array.isArray(value)) {
        const existingSet = new Set(merged[key])
        for (const item of value) {
          if (!existingSet.has(item)) {
            merged[key].push(item)
          }
        }
      } else if (typeof merged[key] === "object" && typeof value === "object" && !Array.isArray(merged[key])) {
        merged[key] = { ...merged[key], ...value }
      }
    } else {
      merged[key] = value
    }
  }

  return merged
}

export function mergeArray(existing, gvItems, marker) {
  if (!Array.isArray(existing)) existing = []
  if (!Array.isArray(gvItems)) gvItems = []
  const merged = existing.filter(
    (item) => !gvItems.includes(item)
  )
  merged.push(...gvItems)

  if (marker) {
    merged.push(`# GStack: ${marker}`)
  }

  return merged
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
