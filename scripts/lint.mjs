#!/usr/bin/env node
// Lint zero-dependência: roda `node --check` (parse/sintaxe) em todo .js/.mjs de
// src/, tests/ e scripts/. É o gate de sintaxe honesto do projeto — NÃO é um
// type-checker (o projeto é ESM puro, sem TypeScript). Falha (exit 1) se algum
// arquivo não parsear.
import { readdirSync } from "fs"
import { join, extname, dirname } from "path"
import { execFileSync } from "child_process"
import { fileURLToPath } from "url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const DIRS = ["src", "tests", "scripts"]
const files = []

function walk(d) {
  let entries
  try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if ([".js", ".mjs"].includes(extname(e.name))) files.push(p)
  }
}

for (const d of DIRS) walk(join(root, d))

let errors = 0
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" })
  } catch (e) {
    errors++
    const msg = (e.stderr || e.message || "").toString().split("\n").slice(0, 3).join("\n")
    console.error(`✗ ${f}\n${msg}`)
  }
}

console.log(`lint: ${files.length} arquivos checados, ${errors} com erro de sintaxe`)
process.exit(errors ? 1 : 0)
