import { readFileSync } from "fs"
import { join } from "path"
import { KNOWLEDGE, EXECUTION, NEUTRAL } from "../meta/command-layers.js"

/**
 * Skill Drift & Safety Doctor (PRD29 29.7 / PRD34 F5-D).
 *
 * O catálogo (29.0) já dá hash por skill. Este módulo usa esse hash como
 * BASELINE e detecta:
 *  - DRIFT: skill cujo hash mudou (added/removed/drifted) vs o baseline gravado;
 *  - STALE: skill que cita um comando do CLI que NÃO existe (doc mente);
 *  - RISK:  skill com sinal destrutivo/rede/secrets (classificado pelo catálogo).
 *
 * `stale` é PROBLEMA (a doc engana o usuário) → reprova sempre. `drift` só
 * reprova em `--strict` (release não deve levar skill alterada sem re-baseline).
 * `risk` é informativo (skills legitimamente fazem coisas destrutivas). PURO/testável.
 */

export const DRIFT_DOCTOR_SCHEMA = "gstack.skill-drift-doctor.v1"
export const SKILL_BASELINE_SCHEMA = "gstack.skill-baseline.v1"

// Fonte única dos comandos reais do CLI (mesmo firewall Knowledge/Execution).
export const KNOWN_COMMANDS = Object.freeze([...KNOWLEDGE, ...EXECUTION, ...NEUTRAL])

/** io padrão que lê o corpo de uma skill relativa a `root`. */
export function defaultBodyIo(root) {
  return { read: (rel) => readFileSync(join(root, rel), "utf-8") }
}

/** Baseline = hash por path (provenance/drift). MEDIDO do catálogo. */
export function computeBaseline(catalog) {
  const hashes = {}
  for (const s of catalog.skills) hashes[s.path] = s.hash
  return {
    schemaVersion: SKILL_BASELINE_SCHEMA,
    generatedAt: new Date().toISOString(),
    totalSkills: catalog.totalSkills,
    hashes,
  }
}

const hashMap = (skills) => {
  const m = {}
  for (const s of skills) m[s.path] = s.hash
  return m
}
const baselineHashes = (baseline) => (baseline && baseline.hashes) || {}

// added (path novo) e drifted (hash mudou) — comparados contra o baseline.
function classifyAgainst(current, base) {
  const added = [], drifted = []
  for (const [p, h] of Object.entries(current)) {
    if (!(p in base)) added.push(p)
    else if (base[p] !== h) drifted.push(p)
  }
  return { added, drifted }
}

/** Compara o catálogo atual com o baseline: added/removed/drifted/unchanged. */
export function diffBaseline(catalog, baseline) {
  const base = baselineHashes(baseline)
  const current = hashMap(catalog.skills)
  const { added, drifted } = classifyAgainst(current, base)
  const removed = Object.keys(base).filter((p) => !(p in current))
  const unchanged = Object.keys(current).filter((p) => base[p] === current[p]).length
  return {
    hasBaseline: Boolean(baseline && baseline.hashes),
    added: added.sort(), removed: removed.sort(), drifted: drifted.sort(), unchanged,
  }
}

// Comandos citados no corpo. Só as formas EXPLÍCITAS de invocação do CLI, com
// separador HORIZONTAL ([ \t], nunca \n) para não capturar prosa da linha
// seguinte (ex.: um título "…gstack_vibehard" + parágrafo "Instale…").
const CMD_PATTERNS = Object.freeze([
  /gstack_vibehard[ \t]+([a-z][a-z-]+)/gi,
  /node[ \t]+src\/index\.js[ \t]+([a-z][a-z-]+)/gi,
])

// Remove o frontmatter YAML (prose de description mora lá — não é invocação).
const stripFrontmatter = (text) => String(text).replace(/^---\r?\n[\s\S]*?\r?\n---/, "")

/** Comandos do CLI citados no CORPO (deduplicados, ordenados). */
export function citedCommands(body) {
  const scanned = stripFrontmatter(body)
  const set = new Set()
  for (const re of CMD_PATTERNS) {
    for (const m of scanned.matchAll(re)) set.add(m[1].toLowerCase())
  }
  return [...set].sort()
}

/** Comandos citados que NÃO existem no CLI. */
export function staleCommands(cited, known = KNOWN_COMMANDS) {
  const knownSet = new Set(known)
  return cited.filter((c) => !knownSet.has(c))
}

const candidateText = (candidate) => [candidate.title || "", ...(candidate.procedure?.steps || [])].join("\n")

/**
 * PRD46 S46.6 — mesma disciplina de comando citado/stale (§ acima), aplicada a um
 * CANDIDATE aprendido (não uma skill instalada) — reusa `citedCommands`/
 * `staleCommands`, nunca duplica a lógica de detecção.
 */
export function candidateCommandDrift(candidate, known = KNOWN_COMMANDS) {
  const cited = citedCommands(candidateText(candidate))
  return { cited, stale: staleCommands(cited, known) }
}

function findStale(catalog, io, known) {
  const out = []
  for (const s of catalog.skills) {
    const missing = staleCommands(citedCommands(io.read(s.path)), known)
    if (missing.length) out.push({ path: s.path, id: s.id, missingCommands: missing })
  }
  return out
}

/** Skills por nível de risco declarado (do catálogo). */
export function scanRisk(catalog) {
  return {
    high: catalog.skills.filter((s) => s.risk === "high").map((s) => s.path),
    medium: catalog.skills.filter((s) => s.risk === "medium").map((s) => s.path),
  }
}

const driftClean = (d) => d.added.length === 0 && d.removed.length === 0 && d.drifted.length === 0
function doctorOk(stale, drift, strict) {
  if (stale.length > 0) return false
  if (strict && drift.hasBaseline && !driftClean(drift)) return false
  return true
}

/**
 * Doctor agregado. `io` (leitura de corpo) habilita a checagem de stale;
 * sem `io`, só drift+risk. `ok` reprova em stale sempre e em drift só com strict.
 */
export function runDriftDoctor({ catalog, baseline = null, io = null, known = KNOWN_COMMANDS, strict = false } = {}) {
  const drift = diffBaseline(catalog, baseline)
  const risk = scanRisk(catalog)
  const stale = io ? findStale(catalog, io, known) : []
  return {
    schemaVersion: DRIFT_DOCTOR_SCHEMA,
    generatedAt: new Date().toISOString(),
    strict,
    ok: doctorOk(stale, drift, strict),
    hasBaseline: drift.hasBaseline,
    drift, stale, risk,
  }
}
