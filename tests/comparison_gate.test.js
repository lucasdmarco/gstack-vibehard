import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const docsRoot = path.join(repoRoot, ".docs")

// Marcador que identifica um doc de COMPARAÇÃO (só esses passam pelo gate).
const MARKER = /gstack-comparison-doc:\s*v\d+/

// Varre .docs/** por arquivos .md (best-effort; .docs pode não existir num checkout raso).
function collectMarkdown(dir, acc) {
  let entries
  try { entries = readdirSync(dir) } catch { return acc }
  for (const name of entries) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) collectMarkdown(full, acc)
    else if (name.endsWith(".md")) acc.push(full)
  }
  return acc
}

function comparisonDocs() {
  return collectMarkdown(docsRoot, []).filter((f) => MARKER.test(readFileSync(f, "utf-8")))
}

test("gate: todo doc de comparação (marcador gstack-comparison-doc) cita o registry", () => {
  const docs = comparisonDocs()
  for (const f of docs) {
    const md = readFileSync(f, "utf-8")
    assert.match(md, /repository-registry\.json/,
      `${path.relative(repoRoot, f)} deve citar .docs/RESEARCH/repository-registry.json`)
    assert.match(md, /batch-6-aidd-methodology/,
      `${path.relative(repoRoot, f)} deve referenciar o batch AIDD obrigatório`)
  }
})

test("gate: o template de comparação existe e é reconhecido pelo marcador", () => {
  const template = path.join(docsRoot, "RESEARCH", "comparison-template.md")
  const md = readFileSync(template, "utf-8")
  assert.match(md, MARKER, "template tem o marcador")
  // o próprio template é o piso do gate: cita registry + batch AIDD.
  assert.ok(comparisonDocs().some((f) => f === template), "template é coletado como doc de comparação")
})

test("instruções project-scoped (AGENTS.md/CLAUDE.md) exigem o registry antes de comparar", () => {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const md = readFileSync(path.join(repoRoot, name), "utf-8")
    assert.match(md, /repository-registry\.json/, `${name} manda ler o registry`)
    assert.match(md, /batch-6-aidd-methodology/, `${name} cita o batch AIDD obrigatório`)
    assert.match(md, /archived_reference/, `${name} explica referência histórica`)
    assert.match(md, /Knowledge vs Execution/i, `${name} documenta o firewall`)
  }
})
