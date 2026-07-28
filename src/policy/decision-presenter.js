/**
 * PRD48 S48.4 — presenter de decisão. NUNCA decide sozinho: recebe a decisão JÁ REAL da
 * Policy DSL (`evaluate()`, `policy/schema.js`) e traduz em ação/alvo/risco/policy +
 * escolhas seguras. `deny` NUNCA aparece como opção aprovável. Categorias sensíveis
 * (destrutivo/secret/rede/cloud/deploy/fora-do-projeto) nunca permitem persistir
 * "permitir sempre" — mudança de policy permanente continua exclusiva do comando `policy`.
 */
export const DECISION_PRESENTER_SCHEMA = "gstack.decision-presenter.v1"

export const SENSITIVE_CATEGORIES = Object.freeze([
  "destructive", "secret", "network_sensitive", "cloud_handoff", "deploy", "outside_project",
])

/** Categoria sensível NUNCA pode virar "permitir sempre" persistido. */
export function canPersistChoice(category) {
  return !SENSITIVE_CATEGORIES.includes(category)
}

/**
 * PRD51 S51.7.2 — elo que faltava: `canPersistChoice`/`yesFlagBypassesGate`
 * recebem uma CATEGORIA, mas nada no repo derivava categoria de um alvo real
 * — as duas funções eram inalcançáveis fora de teste. Deriva a categoria do
 * alvo tipado da própria Policy DSL (`parseTarget`), sem inventar taxonomia
 * nova: a ordem é do mais sensível pro menos (primeiro que casa vence).
 */
const CATEGORY_RULES = Object.freeze([
  { category: "secret", kinds: ["Write", "Read"], re: /(^|[/\\])\.env|secret|credential|\.pem$|id_rsa/i },
  { category: "destructive", kinds: ["Exec"], re: /^\s*(rm|sudo|dd|mkfs|shutdown|reboot)\b|--force(?!-with-lease)|\bdrop\s+(table|database|schema)\b/i },
  { category: "deploy", kinds: ["Exec"], re: /\b(deploy|publish|npm\s+publish|vercel|terraform\s+apply|kubectl\s+apply)\b/i },
  { category: "network_sensitive", kinds: ["Exec"], re: /\b(curl|wget|ssh|scp|rsync)\b|\bgit\s+push\b/i },
  { category: "cloud_handoff", kinds: ["mcp"], re: /.*/ },
  { category: "outside_project", kinds: ["Write", "Read"], re: /^([a-zA-Z]:[/\\]|\/|~[/\\])|\.\.[/\\]/ },
])

/** @returns {string} categoria derivada do alvo real; `read_only` p/ leitura, `standard` p/ o resto. */
export function categorizeTarget(parsed) {
  const { kind, pattern } = parsed || {}
  const hit = CATEGORY_RULES.find((r) => r.kinds.includes(kind) && r.re.test(String(pattern || "")))
  if (hit) return hit.category
  return kind === "Read" ? "read_only" : "standard"
}

/** `--yes` (aprovação em lote) NUNCA ultrapassa uma categoria sensível — mesma lista,
 * proposito distinto: aqui é sobre aprovação de UMA execução, não persistência. */
export function yesFlagBypassesGate(category) {
  return !SENSITIVE_CATEGORIES.includes(category)
}

const CHOICES_BY_DECISION = Object.freeze({
  ask: Object.freeze(["allow_once", "deny_and_pause", "view_details"]),
  deny: Object.freeze(["acknowledge_denied", "view_details"]),
  allow: Object.freeze(["proceed"]),
  default: Object.freeze(["allow_once", "deny_and_pause", "view_details"]),
})

/**
 * Traduz a decisão real (`evaluate()`) em presenter humano — nunca decide, só explica.
 * `category` é opcional (S51.7.2): quando informada, o presenter declara se a escolha
 * pode virar preferência persistida — categoria sensível NUNCA pode.
 */
export function presentDecision({ action, target, risk, evaluation, category = null } = {}) {
  const { decision, rule } = evaluation
  return {
    schemaVersion: DECISION_PRESENTER_SCHEMA,
    action, target, risk,
    policy: { decision, rule },
    choices: [...(CHOICES_BY_DECISION[decision] || CHOICES_BY_DECISION.default)],
    ...(category ? { category, canPersist: canPersistChoice(category) } : {}),
  }
}
