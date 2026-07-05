import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const trailDir = path.join(repoRoot, ".docs", "TRAILS", "ai-driven-dev")
const layersMod = path.join(repoRoot, "src", "meta", "command-layers.js")

const LESSONS = [
  "01-nova-stack-do-dev.md",
  "02-ides-agentic-e-harnesses.md",
  "03-ai-no-pipeline-devsecops.md",
  "04-modernizacao-e-refactoring.md",
  "05-gstack-na-pratica.md",
]

// As 7 seções exigidas pelo PRD21 §4.5.
const SECTIONS = [
  /##\s*Objetivo/i,
  /##\s*Comandos GStack reais/i,
  /##\s*Erros comuns/i,
  /##\s*Checklist/i,
  /##\s*Exerc[ií]cio/i,
  /##\s*Como validar/i,
  /##\s*Como desfazer|rollback/i,
]

function read(name) {
  return readFileSync(path.join(trailDir, name), "utf-8")
}

test("trilha: as 5 aulas existem com as 7 seções do PRD21 §4.5", () => {
  for (const name of LESSONS) {
    const md = read(name)
    for (const re of SECTIONS) assert.match(md, re, `${name} precisa da seção ${re}`)
    assert.match(md, /nunca.*(depend[eê]ncia runtime)|dependência runtime/i,
      `${name} reforça: metodologia nunca vira dependência runtime`)
  }
})

test("trilha: só cita comandos GStack REAIS (cruza com command-layers)", async () => {
  const { layerOf } = await import(`${pathToFileURL(layersMod)}?t=${Date.now()}`)
  const cited = new Set()
  for (const name of LESSONS) {
    const md = read(name)
    for (const m of md.matchAll(/gstack_vibehard\s+([a-z0-9-]+)/g)) cited.add(m[1])
  }
  assert.ok(cited.size > 0, "as aulas citam comandos")
  const bogus = [...cited].filter((c) => layerOf(c) === "unknown")
  assert.deepEqual(bogus, [], `aulas citam comandos inexistentes: ${bogus.join(", ")}`)
})

test("trilha: aula 05 traz o mapa AIDD→GStack", () => {
  const md = read("05-gstack-na-pratica.md")
  assert.match(md, /Mapa AIDD\s*.\s*GStack/i, "aula 05 tem a tabela de mapeamento")
  assert.match(md, /aidd-orchestrator/, "mapa inclui as fases AIDD")
})
