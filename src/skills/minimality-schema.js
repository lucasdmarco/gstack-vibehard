/**
 * Minimality decision-evidence schema (PRD49 S49.5).
 *
 * Evidência que justifica introduzir dependência/abstração nova — nunca
 * diff/LOC bruto. `PROTECTED_CONCERNS` NUNCA são bloqueados por minimality,
 * mesmo sem justificativa (segurança/testes/a11y/etc. nunca esperam por uma
 * "razão" registrada).
 */
export const MINIMALITY_SCHEMA = "gstack.minimality.v1"

export const DECISION_EVIDENCE_FIELDS = Object.freeze([
  "necessary", "existingReuse", "platformOrStdlib", "installedDependency",
  "newDependencyReason", "smallestCompleteApproach", "protectedConcerns",
])

export const PROTECTED_CONCERNS = Object.freeze([
  "security", "validation", "tests", "accessibility", "observability", "explicit_user_scope",
])
