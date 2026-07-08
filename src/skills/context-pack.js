import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from "fs"
import { join, dirname } from "path"

/**
 * Context Pack compartilhado por run (PRD28 28.2 + 28.6 / PRD34 F3-A).
 *
 * Paralelizar sem um pacote de contexto COMPARTILHADO faz cada subtarefa re-extrair
 * o mundo (double context) — desperdício de tokens e divergência. Este módulo compila
 * um pacote compacto por run/projeto, EXCLUI secrets e contabiliza tokens (estimativa
 * honesta). O guard `no-double-context` bloqueia paralelismo sem pack fresco.
 * PURO/testável (io injetável).
 */

export const CONTEXT_PACK_SCHEMA = "gstack.context-pack.v1"

// Caminhos NUNCA incluídos no pack (nem como referência de conteúdo).
const SECRET_PATTERNS = Object.freeze([
  /\.env(\..+)?$/i, /(^|[\\/])secrets?[\\/.]/i, /credential/i, /\.pem$/i, /id_rsa/i, /\.key$/i,
  /[._\-/]token|token[._\-]/i, // token adjacente a separador (evita "tokenizer")
])
export function isSecretPath(p) { return SECRET_PATTERNS.some((re) => re.test(String(p || ""))) }

// Estimativa honesta ~4 chars/token (isEstimate:true sempre — nunca finge precisão).
const estimateTokens = (text) => Math.ceil(String(text || "").length / 4)

const defaultIo = Object.freeze({
  exists: existsSync,
  readJson: (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } },
  writeJson: (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + "\n") },
  mtime: (p) => { try { return statSync(p).mtimeMs } catch { return null } },
})

/** Caminho do pack: runId → run-scoped; sem runId → pack compartilhado do projeto. */
export function packPath(root, runId = null) {
  return runId ? join(root, ".gstack", "runs", runId, "context-pack.json") : join(root, ".gstack", "context-pack.json")
}

/** Monta o pacote de contexto — secrets excluídos, token accounting estimado. */
export function buildContextPack({ runId = null, objective = "", files = [], graphSummary = null } = {}) {
  const safe = files.filter((f) => !isSecretPath(f))
  const excluded = files.filter(isSecretPath)
  const body = [objective, ...safe].join("\n")
  return {
    schemaVersion: CONTEXT_PACK_SCHEMA, generatedAt: new Date().toISOString(), runId,
    objective, files: safe, excludedSecrets: excluded, graphSummary,
    tokenAccounting: { isEstimate: true, estimatedTokens: estimateTokens(body), fileCount: safe.length },
  }
}

export function writeContextPack({ root, runId = null, pack, io = defaultIo } = {}) {
  const p = packPath(root, runId)
  io.writeJson(p, pack)
  return p
}

/** Gera e grava um pack compartilhado a partir do grafo (best-effort). */
export function generateSharedPack({ root, objective = "", io = defaultIo } = {}) {
  const graph = io.readJson(join(root, "graphify-out", "graph.json"))
  const graphSummary = graph ? { present: true, nodes: graph.nodes?.length ?? null, edges: graph.edges?.length ?? null } : { present: false }
  const pack = buildContextPack({ runId: null, objective, files: [], graphSummary })
  writeContextPack({ root, runId: null, pack, io })
  return pack
}

// Motivo de "stale" (decomposto p/ manter cc baixa). null = fresco.
function stalenessReason(packMtime, graphMtime, maxAgeMs) {
  if (graphMtime && packMtime && graphMtime > packMtime) return "grafo mais novo que o pack"
  if (packMtime && Date.now() - packMtime > maxAgeMs) return "pack expirado"
  return null
}

/** Estado do pack: missing | stale (grafo mais novo OU expirado) | fresh. */
export function contextPackState({ root, runId = null, io = defaultIo, graphPath = null, maxAgeMs = 24 * 3600 * 1000 } = {}) {
  const p = packPath(root, runId)
  if (!io.exists(p)) return { state: "missing", reason: "context-pack.json ausente" }
  const gPath = graphPath || join(root, "graphify-out", "graph.json")
  const graphMtime = io.exists(gPath) ? io.mtime(gPath) : null
  const reason = stalenessReason(io.mtime(p), graphMtime, maxAgeMs)
  return reason ? { state: "stale", reason } : { state: "fresh", reason: null }
}

/**
 * Guard no-double-context: só relevante em paralelo. Bloqueia (ok:false) quando
 * não há pack fresco compartilhado — o chamador pode gerar (generate_or_block).
 */
export function evaluateDoubleContextGuard({ root, runId = null, parallel = false, io = defaultIo } = {}) {
  if (!parallel) return { ok: true, applicable: false, state: null }
  const st = contextPackState({ root, runId, io })
  return {
    ok: st.state === "fresh", applicable: true, state: st,
    requiredAction: st.state === "fresh" ? null
      : "Gere um Context Pack fresco compartilhado antes de paralelizar (evita re-extração por subtarefa).",
  }
}
