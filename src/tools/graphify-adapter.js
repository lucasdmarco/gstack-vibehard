import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { extractKeywords, graphifyBackend } from "../context-docs/scout.js"

/**
 * Graphify query-first adapter (PRD49 S49.4).
 *
 * NÃO duplica o que já existe: versão/freshness/métricas do grafo já são
 * medidas por `src/tools/readiness.js` (`probeGraphify`); a query bounded já
 * roda em `src/context-docs/scout.js` (`graphifyBackend`, max=5 por padrão).
 * Este módulo fecha os gaps reais: (1) subcomandos REALMENTE suportados,
 * sourced do próprio código — nunca inventados; (2) policy soft/strict
 * explícita, nunca implícita; (3) migração honesta do `.graphify/deps.json`
 * legado (read-only, nunca migra/apaga sozinho); (4) declaração honesta de
 * conformance por harness — nenhum "enforced" sem prova (mesmo invariante de
 * `claimsFakeHooks` em `harness/capabilities.js`).
 */

// Subcomandos REALMENTE invocados por este código hoje:
//   update  -> src/tools/refresh.js ("graphify", ["update", "."])
//   index   -> readiness.js FRESHNESS_ACTIONS.absent recomenda "graphify index ."
//   hook install -> src/installer/agent-distribution.js / cli/create.js
// Não existe subcomando "query" — GStack lê graphify-out/graph.json direto
// (scout.js), nunca faz shell-out pra consultar o grafo.
export const GRAPHIFY_SUBCOMMANDS = Object.freeze(["update", "index", "hook install", "--version"])

export const QUERY_FIRST_POLICIES = Object.freeze(["soft_query_first", "strict_first_read"])

/** Lê `.gstack/policy.json` do projeto. Ausente/malformado -> {} honesto, nunca lança. */
export function loadProjectPolicyFile(cwd) {
  const p = join(cwd, ".gstack", "policy.json")
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, "utf-8")) || {} }
  catch { return {} }
}

/** Default `soft_query_first`; `strict_first_read` só com policy EXPLÍCITA e válida do projeto. */
export function resolveQueryFirstPolicy(projectPolicy) {
  const v = projectPolicy?.contextRetrieval?.graphifyQueryFirst
  return QUERY_FIRST_POLICIES.includes(v) ? v : "soft_query_first"
}

const STALE_ACTION = "tools refresh --changed (ou `graphify update .`)"

/**
 * Query bounded no grafo, policy-aware. `freshness` vem de `readiness.js` (não
 * reimplementado aqui). `strict_first_read` + stale -> recusa servir (honesto:
 * melhor não responder do que responder com topologia desatualizada como se
 * fosse atual). `soft_query_first` + stale -> serve com aviso, nunca bloqueia.
 */
export function queryGraphFirst({ cwd, question = "", policy = "soft_query_first", freshness = {} } = {}) {
  if (policy === "strict_first_read" && freshness.state === "stale") {
    return { blocked: true, results: [], recommendedAction: freshness.recommendedAction || STALE_ACTION }
  }
  const keywords = extractKeywords(question)
  const { results } = graphifyBackend(cwd, keywords)
  return {
    blocked: false,
    results,
    staleWarning: freshness.state === "stale" ? (freshness.recommendedAction || STALE_ACTION) : null,
  }
}

/** Read-only: detecta `.graphify/deps.json` legado. Nunca migra/apaga sozinho. */
export function legacyDepsJsonStatus(cwd) {
  const p = join(cwd, ".graphify", "deps.json")
  if (!existsSync(p)) return { present: false, path: p, migrationNote: null }
  return {
    present: true,
    path: p,
    migrationNote: "`.graphify/deps.json` é o formato legado (project-init). O mecanismo atual é " +
      "`graphify-out/graph.json` (via `graphify update .`), consumido por `context-docs/scout.js`. " +
      "GStack NUNCA apaga ou reescreve este arquivo automaticamente — migração é decisão do usuário.",
  }
}

/** Extrai a versão do stdout de `graphify --version`. Sem probe real -> unknown honesto. */
export function detectGraphifyPackage({ probe }) {
  const res = probe("graphify", ["--version"])
  if (!res.ok) return { detected: false, version: null }
  const m = /(\d+\.\d+\.\d+)/.exec(res.stdout || "")
  return { detected: true, version: m ? m[1] : null }
}

// Conformance honesta por harness (PRD49 §49.4 DoD): nenhum harness pode reivindicar
// "enforced" pra query-first sem um mecanismo real que INTERCEPTE a ordem de leitura
// (nenhum existe hoje — hooks reais existem mas não checam "leu o grafo antes de N
// arquivos"). Mesmo invariante de `claimsFakeHooks` em harness/capabilities.js.
export const GRAPHIFY_QUERY_FIRST_CONFORMANCE = Object.freeze({
  claude: {
    route: "advisory",
    reason: "hook real (PostToolUse, S49.3) existe mas não intercepta ORDEM de leitura de arquivo vs consulta ao grafo — sem enforcement de query-first.",
  },
  codex: {
    route: "advisory",
    reason: "instructional-only (AGENTS.md); o agente pode ignorar o texto, nunca é enforcement.",
  },
  opencode: {
    route: "advisory",
    reason: "plugins tool.execute.before existem (rules_only) mas nenhum verifica se o grafo foi consultado antes de ler arquivos.",
  },
})
