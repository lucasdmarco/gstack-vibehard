/**
 * PRD47 S47.9 — Golden Workflow vertical `saas-auth-stripe`: prova UMA trilha
 * completa antes de generalizar (47.10). Duas responsabilidades puras:
 *
 *  1. `credentialStatus`/`stripeGate`/`supabaseGate` — o scaffold real do template
 *     (`src/cli/create.js`) grava placeholders (`sk_test_change-me` etc.) em
 *     `.env.example`. Isso NUNCA pode ser confundido com credencial real: sem
 *     credencial real, a evidência de Stripe/Supabase é `blocked`, nunca "verde"
 *     por omissão (DoD do sprint, linha 6).
 *  2. `buildVerticalReport` — agrega as 14 evidências obrigatórias num relatório
 *     honesto: só `proved` quando TODAS as 14 estão presentes E `proved`; qualquer
 *     ausência ou falha vira `partial` — mesma disciplina do `delivery-verdict.js`
 *     (S47.6): score alto nunca esconde uma evidência faltando.
 */
export const VERTICAL_REPORT_SCHEMA = "gstack.golden-workflow-vertical.v1"

const PLACEHOLDER_RX = /change-me/i

/** absent | placeholder | present — placeholder de scaffold NUNCA conta como credencial real. */
export function credentialStatus(value) {
  if (!value) return "absent"
  return PLACEHOLDER_RX.test(String(value)) ? "placeholder" : "present"
}

/** Gate de credencial de terceiro: só `eligible` com TODAS as chaves reais — nunca por omissão. */
export function thirdPartyCredentialGate(env = {}, keys = []) {
  const statuses = keys.map((key) => ({ key, status: credentialStatus(env[key]) }))
  const missing = statuses.filter((s) => s.status !== "present")
  if (missing.length === 0) return { status: "eligible", missing: [] }
  return { status: "blocked", reason: "credencial real ausente/placeholder — nunca verde sem ela", missing }
}

export const STRIPE_KEYS = Object.freeze(["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"])
export const SUPABASE_KEYS = Object.freeze(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])

export const stripeGate = (env = {}) => thirdPartyCredentialGate(env, STRIPE_KEYS)
export const supabaseGate = (env = {}) => thirdPartyCredentialGate(env, SUPABASE_KEYS)

/** As 14 evidências obrigatórias do §11 Sprint 47.9 do PRD47. */
export const EVIDENCE_IDS = Object.freeze([
  "brief_persisted", "design_direction", "scaffold_deps_installed", "runtime_started",
  "login_exercised", "stripe_test_mode", "panel_observed_browser", "console_network_a11y_clean",
  "unhappy_path", "repair_loop_proved", "verify_proof_acceptance", "resume_via_context_delta",
  "rollback_to_green", "no_global_writes",
])

const VALID_STATUSES = new Set(["proved", "blocked", "not_executed"])

/** UM item de evidência — id/status TIPADOS, sem meio-termo silencioso. */
export function evidenceItem(id, status, detail = null) {
  if (!EVIDENCE_IDS.includes(id)) throw new Error(`evidência desconhecida: ${id}`)
  if (!VALID_STATUSES.has(status)) throw new Error(`status de evidência inválido: ${status}`)
  return { id, status, detail }
}

/**
 * Relatório agregado das 14 evidências. `overall` só é `proved` quando NENHUMA
 * falta E TODAS têm status `proved` — qualquer lacuna vira `partial`, nunca
 * "trilha completa" por decreto.
 */
export function buildVerticalReport(items = []) {
  const missing = EVIDENCE_IDS.filter((id) => !items.some((i) => i.id === id))
  const notProved = items.filter((i) => i.status !== "proved").map((i) => i.id)
  const overall = missing.length === 0 && notProved.length === 0 ? "proved" : "partial"
  return { schemaVersion: VERTICAL_REPORT_SCHEMA, items, missing, notProved, overall }
}
