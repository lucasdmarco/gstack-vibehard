/**
 * Catálogo de ferramentas com SEGURANÇA (PRD18 Sprint 8). Cada entrada carrega
 * origem, risco, enforcement e o COMANDO DE INSTALL SUGERIDO — nunca executado por
 * default. Ferramentas remotas NÃO instalam sozinhas; MCP companion é sempre opt-in;
 * tools geradas exigem proof artifacts (provenance).
 */

export const TOOL_ORIGINS = Object.freeze(["local", "bundled", "remote"])
export const TOOL_RISK = Object.freeze(["low", "medium", "high"])

function resolveOrigin(entry) {
  if (entry.origin) return entry.origin
  return entry.remote ? "remote" : "local"
}
function entrySlug(entry) { return entry.slug || entry.name || "?" }
function installCmd(entry, slug, remote) {
  if (entry.installCommand) return entry.installCommand
  return remote ? `gstack_vibehard tools install ${slug}` : null
}

/** Risco determinístico: remoto sobe; MCP companion / rede sobem mais. */
export function classifyRisk(entry = {}) {
  const remote = resolveOrigin(entry) === "remote"
  if (remote && (entry.mcpCompanion || entry.network)) return "high"
  return remote ? "medium" : "low"
}

/** Anota uma entrada crua do catálogo com os campos de segurança. */
export function annotateCatalogEntry(entry = {}) {
  const origin = resolveOrigin(entry)
  const remote = origin === "remote"
  const slug = entrySlug(entry)
  return {
    slug, name: entry.name || slug,
    origin, remote,
    risk: classifyRisk({ ...entry, origin }),
    enforcement: entry.enforcement || "advisory", // tools orientam; não são gate
    mcpCompanion: !!entry.mcpCompanion,
    mcpCompanionOptIn: true, // MCP companion NUNCA ativa sem opt-in explícito
    autoInstall: false,
    installCommand: installCmd(entry, slug, remote),
    provenanceRequired: remote, // remoto/gerado exige proof artifacts
  }
}

export function buildToolCatalog(items = []) {
  return items.map(annotateCatalogEntry)
}

// Seed local: funciona offline (o catálogo remoto é best-effort por cima).
export const LOCAL_CATALOG = Object.freeze([
  Object.freeze({ slug: "printing-press", name: "Printing Press discovery", origin: "remote", mcpCompanion: true }),
  Object.freeze({ slug: "cli-anything", name: "CLI-Anything (referência de verificação real)", origin: "remote" }),
])
