import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"
import { aggregateConfidence } from "../skills/context-confidence.js"

/**
 * Context Scout (PRD18 Sprint 2): subagente explorador READ-ONLY e econômico.
 * Devolve caminhos + linhas + razão curta — NUNCA despeja arquivos inteiros.
 *
 * Backends locais em ordem (local-first, sem rede):
 *  1. scanner Node puro (walk + match por keyword; `rg` não é dependência);
 *  2. SQLite/FTS dos context docs (injetado pelo comando quando o índice existe);
 *  3. Graphify (graphify-out/graph.json), se presente.
 * FastContext/remoto: NUNCA por default — só com opt-in explícito (não implementado;
 * pedir `--backend fastcontext` retorna erro honesto, não chamada de rede).
 *
 * Garantias: não edita nada; não lê `.env*`/secrets/keychain; estima tokens evitados.
 */

// Paths que o scout NUNCA lê (secrets/ruído). Testado — não é decorativo.
export const SCOUT_DENYLIST = [
  /(^|[\\/])\.env[^\\/]*$/i, // .env, .env.local, .env.production…
  /(^|[\\/])(\.git|node_modules|\.gstack|graphify-out|coverage|dist|build|\.next)([\\/]|$)/i,
  /(^|[\\/])(secrets?|credentials?)[\\/]/i,
  /\.(pem|key|p12|pfx|keystore|dpapi)$/i,
  /(^|[\\/])id_(rsa|ed25519|ecdsa)/i,
  /names\.json$/i, // índice do vault de segredos
  // Curadoria Replit (S42.0E): artefatos portadores de credencial comuns em templates
  // full-stack (Replit-style) que NÃO estavam cobertos. Ver .docs/RESEARCH/replit-project-evidence/.
  /(^|[\\/])\.npmrc$/i, // tokens de registry (_authToken)
  /(^|[\\/])\.netrc$/i, // credenciais de rede
  /(^|[\\/])\.git-credentials$/i, // creds git em texto
  /(^|[\\/])\.pgpass$/i, // senha postgres
  /\.tfstate(\.backup)?$/i, // terraform state (secrets materializados)
  /(^|[\\/])\.aws([\\/]|$)/i, // ~/.aws/credentials
]

const TEXT_EXT = /\.(mjs|cjs|js|ts|tsx|jsx|py|md|json|jsonc|yml|yaml|toml|html|css|txt)$/i
const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES_SCANNED = 3000

const STOPWORDS = new Set([
  // pt
  "como", "onde", "qual", "quais", "que", "para", "por", "com", "sem", "uma", "um", "de", "do", "da", "dos", "das", "no", "na", "nos", "nas", "os", "as", "ao", "e", "ou", "o", "a", "em", "funciona", "esta", "está", "sao", "são", "ser", "tem", "meu", "minha", "isso", "este", "essa",
  // en
  "how", "where", "what", "which", "the", "for", "with", "without", "and", "or", "is", "are", "does", "work", "works", "this", "that", "in", "on", "of", "to", "a", "an", "my", "do",
])

const isUsableToken = (t, seen) => t.length >= 3 && !STOPWORDS.has(t) && !seen.has(t)

/** Extrai keywords determinísticas da pergunta (sem LLM). */
export function extractKeywords(question, max = 6) {
  const tokens = String(question || "").toLowerCase().split(/[^\p{L}\p{N}_-]+/u)
  const seen = new Set()
  const out = []
  for (const t of tokens) {
    if (!isUsableToken(t, seen)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

export function isDeniedPath(relPath) {
  return SCOUT_DENYLIST.some((re) => re.test(relPath))
}

const shouldSkipEntry = (relPath, name, isDir) => isDeniedPath(relPath) || (!isDir && !TEXT_EXT.test(name))

function listEntries(root, rel) {
  try { return readdirSync(join(root, rel), { withFileTypes: true }) } catch { return [] }
}

function* walkFiles(root, rel = "", budget = { files: 0 }) {
  for (const e of listEntries(root, rel)) {
    if (budget.files >= MAX_FILES_SCANNED) return
    const r = rel ? `${rel}/${e.name}` : e.name
    if (shouldSkipEntry(r, e.name, e.isDirectory())) continue
    if (e.isDirectory()) { yield* walkFiles(root, r, budget); continue }
    budget.files++
    yield r
  }
}

/** Junta linhas de hit adjacentes (gap ≤ 3) em ranges. */
export function mergeLines(lines, gap = 3) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b)
  const ranges = []
  for (const n of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && n - last.end <= gap) last.end = n
    else ranges.push({ start: n, end: n })
  }
  return ranges
}

/** Lê o arquivo respeitando o teto de tamanho. null se ilegível/grande. */
function readSmallFile(full) {
  try {
    if (statSync(full).size > MAX_FILE_BYTES) return null
    return readFileSync(full, "utf-8")
  } catch { return null }
}

/** Linhas (1-based) onde cada keyword aparece. Map kw → [lineNo]. */
function collectHits(lines, keywords) {
  const hits = new Map()
  for (let i = 0; i < lines.length; i++) {
    const low = lines[i].toLowerCase()
    for (const kw of keywords) {
      if (!low.includes(kw)) continue
      if (!hits.has(kw)) hits.set(kw, [])
      hits.get(kw).push(i + 1)
    }
  }
  return hits
}

function scanFile(root, rel, keywords, results) {
  const text = readSmallFile(join(root, rel))
  if (text === null) return 0
  const hits = collectHits(text.split("\n"), keywords)
  if (hits.size === 0) return 0
  const allLines = [...hits.values()].flat()
  const reason = `match: ${[...hits.keys()].join(", ")}`
  const confidence = Math.min(1, allLines.length / 4)
  for (const range of mergeLines(allLines).slice(0, 3)) {
    results.push({ file: rel, lineStart: range.start, lineEnd: range.end, reason, confidence, backend: "scan" })
  }
  return text.length
}

/** Backend 1: scanner local puro (sem rg, sem rede). */
export function scanBackend(cwd, keywords) {
  const results = []
  let bytesConsidered = 0
  for (const rel of walkFiles(cwd)) {
    bytesConsidered += scanFile(cwd, rel, keywords, results)
    if (results.length >= 60) break // orçamento duro — scout devolve pouco, não tudo
  }
  return { results, bytesConsidered }
}

function parseSourceLocation(loc) {
  const m = /^L(\d+)(?:-L?(\d+))?$/.exec(String(loc || ""))
  if (!m) return { lineStart: null, lineEnd: null }
  return { lineStart: Number(m[1]), lineEnd: Number(m[2] || m[1]) }
}

/** Nó do grafo → hit do scout (ou null se não casa/negado). */
function graphNodeHit(node, keywords) {
  const label = String(node.norm_label || node.label || "").toLowerCase()
  const kw = keywords.find((k) => label.includes(k))
  if (!kw || !node.source_file || isDeniedPath(node.source_file)) return null
  return {
    file: node.source_file,
    ...parseSourceLocation(node.source_location),
    reason: `graphify: nó '${node.label}' casa '${kw}'`,
    confidence: 0.7,
    backend: "graphify",
  }
}

function readGraph(cwd) {
  const p = join(cwd, "graphify-out", "graph.json")
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null }
}

/** Backend 3: Graphify (graph.json) — topologia de código sem reler arquivos. */
export function graphifyBackend(cwd, keywords, max = 5) {
  const graph = readGraph(cwd)
  if (!graph) return { results: [], available: false }
  const results = []
  for (const node of graph.nodes || []) {
    const hit = graphNodeHit(node, keywords)
    if (!hit) continue
    results.push(hit)
    if (results.length >= max) break
  }
  return { results, available: true }
}

/** Estimativa HONESTA de tokens evitados: corpus considerado vs payload devolvido. */
export function estimateTokensAvoided(bytesConsidered, results) {
  const payloadChars = JSON.stringify(results).length
  const avoided = Math.max(0, Math.round(bytesConsidered / 4 - payloadChars / 4))
  return { estimate: avoided, basis: "bytes_considerados/4 − payload/4 (heurística, não medição)" }
}

function dedupeTop(results, max) {
  const seen = new Set()
  const out = []
  for (const r of results.sort((a, b) => b.confidence - a.confidence)) {
    const key = `${r.file}:${r.lineStart}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
    if (out.length >= max) break
  }
  return out
}

/**
 * Scout principal. `ftsSearch` (opcional, injetado): (question) → [{file, reason, confidence}]
 * — camada de docs (SQLite/FTS) fornecida pelo comando. READ-ONLY por construção.
 */
export function scout({ cwd = process.cwd(), question = "", ftsSearch = null, maxResults = 12 } = {}) {
  const keywords = extractKeywords(question)
  if (keywords.length === 0) {
    return { ok: false, question, keywords, results: [], backendsUsed: [], error: "pergunta sem termos utilizáveis" }
  }
  const backendsUsed = []
  const all = []

  const scan = scanBackend(cwd, keywords)
  backendsUsed.push("scan")
  all.push(...scan.results)

  if (ftsSearch) {
    try {
      const docs = ftsSearch(question) || []
      backendsUsed.push("fts")
      all.push(...docs.map((d) => ({ file: d.file, lineStart: d.lineStart ?? null, lineEnd: d.lineEnd ?? null, reason: d.reason || "doc relevante (FTS)", confidence: d.confidence ?? 0.5, backend: "fts" })))
    } catch { /* FTS é opcional — degrada sem quebrar */ }
  }

  const g = graphifyBackend(cwd, keywords)
  if (g.available) { backendsUsed.push("graphify"); all.push(...g.results) }

  const results = dedupeTop(all, maxResults)
  return {
    ok: true,
    question,
    keywords,
    results,
    backendsUsed,
    contextConfidence: aggregateConfidence(results), // F3-D: confiança agregada do contexto
    tokensAvoided: estimateTokensAvoided(scan.bytesConsidered, results),
    note: "read-only, local-first; paths+linhas, nunca conteúdo bruto; FastContext remoto só com opt-in explícito (não default)",
  }
}
