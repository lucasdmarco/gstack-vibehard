import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const templatePath = path.join(repoRoot, ".docs", "RESEARCH", "comparison-template.md")

function loadTemplate() {
  return readFileSync(templatePath, "utf-8")
}

test("comparison-template: tem o marcador de doc de comparação (gate)", () => {
  const md = loadTemplate()
  assert.match(md, /gstack-comparison-doc:\s*v1/, "marcador HTML que o gate reconhece")
})

test("comparison-template: seções obrigatórias presentes", () => {
  const md = loadTemplate()
  assert.match(md, /##\s*1\.\s*Contexto/i)
  assert.match(md, /##\s*2\.\s*Batches obrigat/i)
  assert.match(md, /Adotar\s*\/\s*adaptar\s*\/\s*rejeitar/i, "tabela de decisão adotar/adaptar/rejeitar")
  assert.match(md, /Invariantes/i)
})

test("comparison-template: cita o registry, o batch AIDD e a regra 'nunca runtime'", () => {
  const md = loadTemplate()
  assert.match(md, /repository-registry\.json/, "aponta para o registry")
  assert.match(md, /batch-6-aidd-methodology/, "menciona o batch AIDD obrigatório")
  assert.match(md, /archived_reference/, "explica marcação de arquivados")
  assert.match(md, /depend[eê]ncia runtime/i, "regra explícita sobre dependência runtime")
  assert.match(md, /nunca/i, "regra: referência metodológica NUNCA vira dependência runtime")
})
