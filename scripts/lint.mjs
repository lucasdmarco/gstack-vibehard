#!/usr/bin/env node
// Lint zero-dependência: roda `node --check` (parse/sintaxe) em todo .js/.mjs de
// src/, tests/ e scripts/. É o gate de sintaxe honesto do projeto — NÃO é um
// type-checker (o projeto é ESM puro, sem TypeScript). Falha (exit 1) se algum
// arquivo não parsear.
import { readdirSync } from "fs"
import { cpus } from "os"
import { join, extname, dirname } from "path"
import { spawn } from "child_process"
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

// `node --check` por arquivo, em PARALELO (limite = nº de CPUs). Spawn de processo
// é caro no Windows; serial levava >120s — paralelo derruba pra poucos segundos.
function checkFile(f) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--check", f], { stdio: ["ignore", "ignore", "pipe"] })
    let err = ""
    p.stderr.on("data", (d) => { err += d })
    p.on("close", (code) => resolve({ f, ok: code === 0, err }))
    p.on("error", (e) => resolve({ f, ok: false, err: e.message }))
  })
}

let errors = 0
const concurrency = Math.max(4, (cpus() || []).length || 4)
for (let i = 0; i < files.length; i += concurrency) {
  const results = await Promise.all(files.slice(i, i + concurrency).map(checkFile))
  for (const r of results) {
    if (!r.ok) { errors++; console.error(`✗ ${r.f}\n${r.err.split("\n").slice(0, 3).join("\n")}`) }
  }
}

// Modo --typecheck: mesmo check de parse REAL (node --check), rotulado com
// honestidade — o projeto é ESM puro (sem TypeScript), então "typecheck" aqui é
// verificação de sintaxe/parse de cada módulo, não inferência de tipos.
const label = process.argv.includes("--typecheck")
  ? "typecheck (ESM puro — parse/sintaxe via node --check, sem TS)"
  : "lint"
console.log(`${label}: ${files.length} arquivos checados, ${errors} com erro de sintaxe`)
process.exit(errors ? 1 : 0)
