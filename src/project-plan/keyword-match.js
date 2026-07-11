/**
 * Matching de keyword por PALAVRA (PRD36 36.5). O classificador antigo usava
 * `hay.includes(kw)` — substring frágil: "api" casava "therapist", "app" casava
 * "apply", "ui" casava "build/guide", "pr" casava "prazo". Aqui o match é por
 * limite de palavra (`\b`), preservando keywords multi-palavra e hífens.
 */

/** Normaliza: minúsculas, sem acentos (para casar "migração"≡"migracao"). */
export function normalize(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Cache de regex por keyword normalizada (evita recompilar por chamada).
const reCache = new Map()
function keywordRegex(kwNorm) {
  let re = reCache.get(kwNorm)
  if (!re) { re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(kwNorm)}(?:$|[^a-z0-9])`, "i"); reCache.set(kwNorm, re) }
  return re
}

/** True se `kw` aparece como PALAVRA inteira em `hayNorm` (já normalizado). */
export function matchesKeyword(hayNorm, kw) {
  const kwNorm = normalize(kw)
  return kwNorm.length > 0 && keywordRegex(kwNorm).test(hayNorm)
}

/** Keywords que casam como palavra inteira no texto normalizado. */
export function matchedKeywords(hayNorm, keywords = []) {
  return keywords.filter((kw) => matchesKeyword(hayNorm, kw))
}
