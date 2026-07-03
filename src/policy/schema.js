import { hasSecret } from "../security/redact.js"

/**
 * Policy DSL canônica cross-harness (PRD15 §7.1). Uma única fonte de verdade em
 * `.gstack/policy.json` que é COMPILADA para cada harness (Devin, Claude, Cursor,
 * OpenCode, …). Contrato: `permissions.{allow,deny,ask}` com alvos tipados
 * (`Read(**)`, `Write(...)`, `Exec(...)`, `mcp__<server>__<tool>`).
 *
 * Ordem de avaliação: deny > allow > ask > default. `deny` sempre vence; um `allow`
 * ESPECÍFICO auto-aprova (senão o catch-all `ask` — ex.: `exec`, `Write(**)` —
 * sombrearia toda allowlist, deixando-a inútil); `ask` pega o resto que precisa de
 * confirmação; sem regra cai no default seguro. (É a semântica real de Devin/Claude;
 * o exemplo default do PRD15 §10.3 só é coerente com allow ANTES de ask.)
 * Um segredo NUNCA entra na policy (ela versiona padrões, não valores).
 */

export const POLICY_SCHEMA_VERSION = "gstack.policy.v1"
export const DECISIONS = Object.freeze(["deny", "ask", "allow", "default"])

// Default conservador (PRD15 §10.3): lê livre, confirma escrita/exec, nega o perigoso.
export const DEFAULT_POLICY = Object.freeze({
  schemaVersion: POLICY_SCHEMA_VERSION,
  permissions: Object.freeze({
    allow: Object.freeze(["Read(**)", "Exec(git status)", "Exec(git diff)", "Exec(git log)", "Exec(npm run lint)", "Exec(npm run test)", "Exec(gstack_vibehard verify)", "mcp__*__list_*", "mcp__*__get_*"]),
    deny: Object.freeze(["Write(.env*)", "Write(**/.env*)", "Exec(rm)", "Exec(sudo)", "Exec(git push)", "mcp__*__delete_*"]),
    ask: Object.freeze(["Write(**)", "exec", "mcp__*"]),
  }),
})

const KNOWN_KINDS = new Set(["Read", "Write", "Exec", "mcp", "raw"])

/** Quebra um alvo textual em { kind, pattern }. `mcp__a__b` e `exec` cru são aceitos. */
export function parseTarget(str) {
  const s = String(str || "").trim()
  const m = /^(Read|Write|Exec)\((.*)\)$/.exec(s)
  if (m) return { kind: m[1], pattern: m[2] }
  if (s.startsWith("mcp__")) return { kind: "mcp", pattern: s }
  return { kind: "raw", pattern: s }
}

/** Converte um glob simples (`*`, `**`) em RegExp ancorado. `**` cruza separadores. */
function globToRe(glob) {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") { re += "[\\s\\S]*"; i++ } else { re += "[^/]*" }
    } else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp("^" + re + "$", "i")
}

/** Um alvo de regra casa com um alvo concreto? (kinds compatíveis + glob). */
export function matchTarget(ruleStr, target) {
  const rule = parseTarget(ruleStr)
  // `exec` cru na policy = qualquer Exec(...). `mcp__*` cru casa qualquer mcp.
  if (rule.kind === "raw" && rule.pattern.toLowerCase() === "exec") return target.kind === "Exec"
  if (rule.kind !== target.kind) return false
  return globToRe(rule.pattern).test(target.pattern)
}

/**
 * Avalia um alvo concreto contra a policy. Precedência deny > allow > ask > default.
 * @returns {{ decision, rule|null }}
 */
export function evaluate(policy, targetStr) {
  const target = parseTarget(targetStr)
  const perms = (policy && policy.permissions) || {}
  for (const decision of ["deny", "allow", "ask"]) {
    const rules = Array.isArray(perms[decision]) ? perms[decision] : []
    const hit = rules.find((r) => matchTarget(r, target))
    if (hit) return { decision, rule: hit }
  }
  return { decision: "default", rule: null }
}

/** Normaliza para o shape canônico (arrays garantidos, versão preenchida). */
export function normalizePolicy(obj = {}) {
  const p = (obj && obj.permissions) || {}
  const arr = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === "string") : [])
  return {
    schemaVersion: obj.schemaVersion || POLICY_SCHEMA_VERSION,
    permissions: { allow: arr(p.allow), deny: arr(p.deny), ask: arr(p.ask) },
  }
}

/** Um alvo textual é reconhecido? (kind tipado, ou `exec` cru). */
function isKnownTarget(t) {
  const kind = parseTarget(t).kind
  return kind !== "raw" ? KNOWN_KINDS.has(kind) : String(t).toLowerCase() === "exec"
}

const isObj = (x) => !!x && typeof x === "object"

function validateBucket(perms, key, errors) {
  const v = perms[key]
  if (v !== undefined && !Array.isArray(v)) { errors.push(`permissions.${key} deve ser array`); return }
  for (const t of Array.isArray(v) ? v : []) {
    if (!isKnownTarget(t)) errors.push(`alvo não reconhecido em ${key}: "${t}"`)
  }
}

function collectPolicyErrors(obj) {
  const errors = []
  if (!isObj(obj.permissions)) errors.push("permissions ausente")
  else for (const k of ["allow", "deny", "ask"]) validateBucket(obj.permissions, k, errors)
  if (hasSecret(JSON.stringify(obj))) errors.push("policy contém o que parece ser um SEGREDO — remova (a policy versiona padrões, nunca valores)")
  return errors
}

/** Valida shape + garante que NENHUM segredo foi colocado na policy. */
export function validatePolicy(obj) {
  if (!isObj(obj)) return { valid: false, errors: ["policy não é objeto"] }
  const errors = collectPolicyErrors(obj)
  return { valid: errors.length === 0, errors }
}
