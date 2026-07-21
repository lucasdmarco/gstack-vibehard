/**
 * PRD46 S46.3 — dedupe determinístico (nome normalizado, trigger tokens, command
 * signatures, failure id). Nunca usa modelo remoto/embedding — só comparação local
 * (§5.2 da matriz de decisão do PRD). Decide `new|update|merge` entre um candidate
 * novo e os candidates JÁ conhecidos (peer-level). Conflito com policy/core — camada
 * de precedência mais alta — é responsabilidade separada de `conflicts.js`.
 */

const STOPWORDS = new Set(["a", "o", "de", "da", "do", "para", "com", "um", "uma", "the", "of", "to", "and", "e", "em", "no", "na"])
const MERGE_THRESHOLD = 0.6

export function normalizeName(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, " ")
}

export function triggerTokens(s) {
  const words = normalizeName(s).split(/[\s-]+/).filter(Boolean)
  return new Set(words.filter((t) => t.length > 2 && !STOPWORDS.has(t)))
}

/** Jaccard determinístico entre dois conjuntos de tokens — 0 se algum for vazio. */
export function tokenOverlap(a, b) {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / Math.max(a.size, b.size)
}

const signatureOf = (c) => c.dedupe?.signature || null
const failureIdOf = (c) => c.failurePattern?.id || null

const sameSignature = (candidate, other) => {
  const s = signatureOf(candidate)
  return !!s && s === signatureOf(other)
}
const sameFailure = (candidate, other) => {
  const f = failureIdOf(candidate)
  return !!f && f === failureIdOf(other)
}
const similarEnough = (candidate, other) => tokenOverlap(triggerTokens(candidate.title), triggerTokens(other.title)) >= MERGE_THRESHOLD

function findMatch(candidate, existing, predicate) {
  return existing.find((other) => predicate(candidate, other)) || null
}

/**
 * @param {{candidate: object, existing?: object[]}} opts
 * @returns {{decision: "new"|"update"|"merge", matchId: string|null}}
 */
export function classifyDedupe({ candidate, existing = [] } = {}) {
  const updateMatch = findMatch(candidate, existing, sameSignature)
  if (updateMatch) return { decision: "update", matchId: updateMatch.id }

  const mergeMatch = findMatch(candidate, existing, sameFailure) || findMatch(candidate, existing, similarEnough)
  if (mergeMatch) return { decision: "merge", matchId: mergeMatch.id }

  return { decision: "new", matchId: null }
}
