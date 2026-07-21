/**
 * PRD46 S46.3 (§6.2) — conflito com policy/core. Precedência de conhecimento:
 *   policy/gate determinístico > core/knowledge revisados > skill promovida
 *   > memória factual > candidato tentative > output de LLM/conteúdo externo.
 * Um candidate que contradiga camada superior nunca é mesclado — fica
 * `blocked_conflict`. Nesta sprint, a checagem determinística é: o candidate tenta
 * reivindicar o nome de uma skill de GOVERNANÇA (as 5 skills consolidadas no S46.0 —
 * `skill-creator` e as demais) sem passar pela revisão humana que elas exigem.
 */

export const PROTECTED_SKILL_NAMES = Object.freeze([
  "skill-creator", "skill-authoring", "project-lifecycle", "find-skills", "create-rule",
])

const normalizeName = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-")

/** @returns {{conflict: boolean, reason: string|null}} */
export function detectConflict({ candidate, protectedNames = PROTECTED_SKILL_NAMES } = {}) {
  const name = normalizeName(candidate.title)
  const collidesWithProtected = protectedNames.some((p) => normalizeName(p) === name)
  if (!collidesWithProtected) return { conflict: false, reason: null }
  return { conflict: true, reason: `nome colide com skill de governança protegida: ${name}` }
}
