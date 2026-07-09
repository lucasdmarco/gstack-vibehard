#!/usr/bin/env node
// Command-lint (PRD30 30.4 / PRD34 F7-A): a doc só cita comando que existe no CLI.
// GATE: falha (exit 1) se README citar comando inexistente. Paridade PT×EN = WARNING.
import { readFileSync, existsSync, readdirSync } from "fs"
import { join } from "path"
import { runCommandLint } from "../src/meta/command-lint.js"

// READMEs primeiro (paridade compara os dois); guias entram só para o lint de comandos.
const README_FILES = ["README.md", "README.en.md"]
const GUIDES_DIR = "docs/guides"

function guideFiles() {
  if (!existsSync(GUIDES_DIR)) return []
  return readdirSync(GUIDES_DIR).filter((f) => f.endsWith(".md")).map((f) => join(GUIDES_DIR, f))
}

function loadDocs() {
  const files = [...README_FILES.filter((f) => existsSync(f)), ...guideFiles()]
  return files.map((f) => ({ name: f, text: readFileSync(f, "utf-8") }))
}

const docs = loadDocs()
const result = runCommandLint({ docs })

for (const f of result.perFile) {
  if (f.unknown.length) console.error(`✗ ${f.name}: comando(s) inexistente(s) no CLI: ${f.unknown.join(", ")}`)
  else console.log(`✓ ${f.name}: todos os comandos citados existem`)
}

if (!result.parityOk) {
  const p = result.parity
  console.warn(`⚠ paridade PT×EN (não bloqueia): só no 1º: [${p.onlyInFirst.join(", ")}] · só no 2º: [${p.onlyInSecond.join(", ")}]`)
}

if (!result.ok) {
  console.error("command-lint: FALHOU — corrija os comandos inexistentes na doc.")
  process.exit(1)
}
console.log("command-lint: OK (nenhum comando inexistente citado).")
