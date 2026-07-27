import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Sidecar de proveniência do Graphify (PRD51 S51.5, ações #2/#3).
 *
 * O `graph.json` real produzido pelo binário `graphify` instalado (confirmado
 * rodando a versão instalada nesta máquina) NÃO tem `built_at_commit` — só
 * `nodes`/`links`/`input_tokens`/`output_tokens`. O commit só existe como
 * texto solto em `GRAPH_REPORT.md` ("Built from commit: `<hash>`"), nunca
 * parseado por nenhum código. Em vez de depender de um campo upstream
 * instável/ausente, GStack registra a proveniência ELE MESMO — já que é ele
 * quem dispara `graphify update .` (`tools/refresh.js`) — num sidecar
 * próprio, resiliente a qualquer schema futuro do `graph.json`.
 */
export const PROVENANCE_SCHEMA = "gstack.graphify-provenance.v1"

function provenancePath(cwd) {
  return join(cwd, ".gstack", "graphify-provenance.json")
}

export function writeGraphifyProvenance(cwd, { commit, graphifyVersion, nowIso } = {}) {
  const dir = join(cwd, ".gstack")
  mkdirSync(dir, { recursive: true })
  const record = {
    schemaVersion: PROVENANCE_SCHEMA,
    builtAtCommit: commit || null,
    graphifyVersion: graphifyVersion || null,
    generatedAt: (nowIso || (() => new Date().toISOString()))(),
  }
  writeFileSync(provenancePath(cwd), JSON.stringify(record, null, 2) + "\n")
  return record
}

export function readGraphifyProvenance(cwd) {
  const p = provenancePath(cwd)
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8"))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch { return null }
}

// Groundwork da ação #3 (adaptar parser à versão do schema): em vez de
// adivinhar valores de um schema desconhecido, detecta e REPORTA chaves de
// topo inesperadas no graph.json — visível/testável, nunca silenciosamente
// ignorado quando o upstream mudar de shape outra vez.
const KNOWN_GRAPH_KEYS = new Set(["nodes", "links", "input_tokens", "output_tokens", "built_at_commit"])
export function graphSchemaDrift(g) {
  if (!g || typeof g !== "object") return []
  return Object.keys(g).filter((k) => !KNOWN_GRAPH_KEYS.has(k))
}
