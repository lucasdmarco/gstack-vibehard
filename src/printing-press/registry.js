/**
 * Registry declarativo de integracoes por projeto (.gstack/integrations.json).
 *
 * Arquitetura HIBRIDA de dupla via — nao substitui o Composio, complementa:
 *  - Composio (nuvem): auth OAuth + acoes de ESCRITA nos apps padrao (@composio/mcp)
 *  - Printing Press (local): LEITURA de alta frequencia via CLI Go + SQLite, e
 *    cauda-longa sem API. Reduz tokens com --compact (economia medida por ledger;
 *    sem percentual cravado sem benchmark reproduzido).
 *
 * Este modulo e PURO (sem efeitos colaterais / sem rede): so monta o objeto.
 * Nada e instalado no bootstrap — tudo opt-in depois via `gstack_vibehard tools`.
 */

export const SCHEMA_VERSION = 1

/** Ferramentas sugeridas por template (declarativo — nao instala nada). */
export const SUGGESTIONS_BY_TEMPLATE = {
  "saas-auth-stripe": ["stripe", "linear", "sentry"],
  "ai-agent-platform": ["github", "slack", "notion", "sentry"],
  "mobile-backend": ["revenuecat", "firebase", "supabase", "sentry"],
  "fullstack-monorepo": ["github", "sentry", "linear"],
}

/**
 * Monta o registry dual-lane para um template.
 * @param {string} templateName
 * @param {object} [opts]
 * @param {string} [opts.composioStatus] "detected" | "not_configured" (default)
 * @returns {object} registry serializavel
 */
export function buildIntegrationsRegistry(templateName, opts = {}) {
  const suggested = SUGGESTIONS_BY_TEMPLATE[templateName] || SUGGESTIONS_BY_TEMPLATE["fullstack-monorepo"]
  return {
    schemaVersion: SCHEMA_VERSION,
    // Via NUVEM — escrita/OAuth. Reaproveita a deteccao ja existente em
    // hooks/hooks/session_start.py (check_composio_status).
    composio: {
      lane: "cloud",
      role: "write+oauth",
      status: opts.composioStatus || "not_configured",
    },
    // Via LOCAL — leitura/cauda-longa. Tudo opt-in (enabled:false ate o usuario pedir).
    printingPress: {
      lane: "local",
      role: "read+longtail",
      enabled: false,
      discoveryInstalled: false,
      installed: [],
      suggested: [...suggested],
      mcp: [],
    },
    // Roteamento padrao: leitura barata local, escrita na nuvem.
    routing: {
      reads: "printing-press",
      writes: "composio",
    },
  }
}
