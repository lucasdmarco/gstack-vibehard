#!/usr/bin/env node
// Limpeza pré-empacotamento: remove artefatos Python (__pycache__/.pyc/.pyo) que
// o `npm pack` incluiria por estarem fisicamente sob dirs do `files` (allowlist).
// Roda no hook `prepack` → todo `npm pack`/`npm publish` sai 100% limpo.
import { readdirSync, rmSync } from "fs"
import { join } from "path"

const SKIP = new Set(["node_modules", ".git"])
let removed = 0

function walk(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "__pycache__") { rmSync(p, { recursive: true, force: true }); removed++; continue }
      walk(p)
    } else if (e.name.endsWith(".pyc") || e.name.endsWith(".pyo")) {
      rmSync(p, { force: true }); removed++
    }
  }
}

walk(process.cwd())
console.log(`clean-pkg: removidos ${removed} artefato(s) __pycache__/.pyc/.pyo`)
