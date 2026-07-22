/**
 * PRD48 S48.2 — plano de adoção brownfield. Nunca decide sozinho entre criar/adotar: o
 * usuário sempre vê as 3 opções (`plan_only|activate_with_backup|cancel`). A ativação
 * deriva um Operation Plan no mesmo formato do PRD45 (`kind/scope/description/reason` —
 * `buildFullProvisionPlan`, `src/cli/create.js`), escopo SEMPRE `project` (nunca global).
 * Dirty tree NUNCA é descartada — a ativação só escreve dentro de `.gstack/`.
 */
export const BROWNFIELD_PLAN_SCHEMA = "gstack.brownfield-plan.v1"
export const BROWNFIELD_CHOICES = Object.freeze(["plan_only", "activate_with_backup", "cancel"])

/** As 3 opções sempre apresentadas ao usuário — nunca decide sozinho. */
export function proposeBrownfieldChoices(discovery) {
  return {
    schemaVersion: BROWNFIELD_PLAN_SCHEMA,
    summary: { languages: discovery.languages, commands: discovery.commands || null, git: discovery.git, gstackActivated: discovery.gstackActivated },
    choices: [...BROWNFIELD_CHOICES],
  }
}

/**
 * Deriva o plano de ativação. Já ativado -> nenhuma operação (idempotente, nunca
 * reescreve). Escopo sempre `project`; dirty tree é preservada sempre, marcado
 * explicitamente para nunca virar suposição silenciosa.
 */
export function buildActivationPlan(discovery) {
  const ops = discovery.gstackActivated ? [] : [
    { id: "gstack-app-manifest", kind: "file", scope: "project", description: "criar .gstack/app.json", reason: "ativar GStack neste projeto existente" },
  ]
  return { schemaVersion: BROWNFIELD_PLAN_SCHEMA, ops, dirtyTreePreserved: true }
}

/** Rota `new` vs `brownfield` a partir do discovery — nunca escreve, só decide a trilha. */
export function decideBrownfieldOrNew(discovery) {
  return discovery.recognized ? "brownfield" : "new"
}
