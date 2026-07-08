/**
 * Contrato canônico de agentes (PRD29 29.9 / PRD34 F5-B).
 *
 * O PRD fala em "21 papéis canônicos", mas o repo tem 20 agentes-fonte + 22 adapters
 * gerados — o descompasso vem de contar adapters/routers/packs como papéis. Este
 * módulo estabelece o contrato: um agente-fonte é PAPEL canônico a menos que seja
 * router (orquestra outros) ou pack (agrupa) — e a CONTAGEM é MEDIDA, nunca hardcoded
 * (mesma lição do skill catalog). PURO/testável.
 */

export const AGENTS_CANONICAL_SCHEMA = "gstack.agents-canonical.v1"

/** role (default) | router | pack — por frontmatter `kind` ou sufixo do id. */
export function classifyAgent(agent) {
  const kind = String(agent.kind || "").toLowerCase()
  if (kind === "router" || /[-_]router$/.test(agent.id)) return "router"
  if (kind === "pack" || /[-_]pack$/.test(agent.id)) return "pack"
  return "role"
}

/** Compila o contrato canônico a partir dos agentes-fonte (aliases source→canônico). */
export function buildCanonicalContract(sourceAgents = []) {
  const roles = [], routers = [], packs = []
  for (const a of sourceAgents) {
    const bucket = { role: roles, router: routers, pack: packs }[classifyAgent(a)]
    bucket.push(a.id)
  }
  return {
    schemaVersion: AGENTS_CANONICAL_SCHEMA,
    generatedAt: new Date().toISOString(),
    canonicalRoles: [...roles].sort(),
    count: roles.length,
    excluded: { routers: [...routers].sort(), packs: [...packs].sort() },
    aliases: Object.fromEntries(sourceAgents.map((a) => [a.id, a.id])),
  }
}

/**
 * Órfãos: papel canônico sem adapter gerado, ou adapter gerado sem papel-fonte.
 * `adapterIds` = ids com adapter (ex.: agents/generated/claude/<id>).
 */
export function findOrphans(contract, adapterIds = []) {
  const roles = new Set(contract.canonicalRoles)
  const adapters = new Set(adapterIds)
  return {
    rolesWithoutAdapter: contract.canonicalRoles.filter((r) => !adapters.has(r)),
    adaptersWithoutRole: adapterIds.filter((a) => !roles.has(a) && !contract.excluded.routers.includes(a) && !contract.excluded.packs.includes(a)),
  }
}

export function renderCanonicalMarkdown(c) {
  return [
    `# Agentes canônicos — ${c.count} papéis (medido)`, "",
    `Gerado: ${c.generatedAt} · schema ${c.schemaVersion}`, "",
    ...c.canonicalRoles.map((r) => `- ${r}`), "",
    `Excluídos (não são papéis): routers=${c.excluded.routers.length}, packs=${c.excluded.packs.length}`, "",
  ].join("\n")
}
