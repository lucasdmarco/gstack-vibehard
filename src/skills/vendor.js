/**
 * Vendoring pipeline de skills externas (PRD29 29.10 / PRD34 F6-B).
 *
 * Depois da auditoria read-only (F6-A), uma skill externa útil pode ser VENDADA
 * para `skills/vendor/<source>/<skill>/` — sempre com license/hash/provenance e
 * SEMPRE `status: advisory` até ter teste próprio. Invariantes:
 *   - `avoid` (destrutivo/exec-remoto/secret/install) NUNCA é vendado;
 *   - mapeamento para gate + agente é OBRIGATÓRIO — sem ele o plano não pode `--apply`;
 *   - `--dry-run` é o default seguro; nada é escrito em skills/ sem `--apply`.
 *
 * PURO/testável: recebe o resultado da auditoria (F6-A), devolve o PLANO. A
 * escrita fica no comando.
 */

export const VENDOR_PLAN_SCHEMA = "gstack.skill-vendor-plan.v1"
export const VENDOR_MANIFEST_SCHEMA = "gstack.skill-vendor.v1"

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()

/** Nome da skill a partir do path (dir da SKILL.md, ou basename sem extensão). */
export function vendorSkillName(relPath) {
  const parts = String(relPath).replaceAll("\\", "/").split("/").filter(Boolean)
  const base = parts[parts.length - 1] || "root"
  if (/^SKILL\.md$/i.test(base)) return parts[parts.length - 2] || "root"
  return base.replace(/\.[^.]+$/, "")
}

/** Diretório-alvo do vendoring (project-relative, POSIX). */
export function vendorTargetDir(source, name) {
  return `skills/vendor/${slug(source)}/${slug(name)}`
}

const isMapped = (m) => Boolean(m && m.gate && m.agent)
const mappedPair = (m) => ({ gate: (m && m.gate) || null, agent: (m && m.agent) || null })

// Manifesto vendor.json de uma skill (advisory até ter teste).
function vendorManifest(decision, ctx, mapping) {
  const mapped = mappedPair(mapping)
  return {
    schemaVersion: VENDOR_MANIFEST_SCHEMA,
    source: ctx.source,
    sourceUrl: ctx.sourceUrl,
    commit: ctx.commit,
    originPath: decision.path,
    hash: decision.hash,
    license: ctx.license,
    decision: decision.decision,
    risk: decision.risk,
    status: "advisory",
    test: "missing",
    mappedGate: mapped.gate,
    mappedAgent: mapped.agent,
    vendoredAt: ctx.generatedAt,
  }
}

function vendorEntry(decision, ctx, mappings) {
  const name = vendorSkillName(decision.path)
  const mapping = mappings[decision.path]
  return {
    originPath: decision.path,
    name,
    targetDir: vendorTargetDir(ctx.source, name),
    needsMapping: !isMapped(mapping),
    manifest: vendorManifest(decision, ctx, mapping),
  }
}

/**
 * Monta o plano de vendoring a partir da auditoria (F6-A). `avoid` é excluído;
 * entradas sem mapeamento gate+agente bloqueiam o `--apply`.
 */
export function buildVendorPlan({ audit, source, sourceUrl = null, commit = null, license = null, mappings = {} } = {}) {
  const generatedAt = new Date().toISOString()
  const ctx = { source, sourceUrl, commit, license: license || "UNKNOWN", generatedAt }
  const avoid = audit.decisions.filter((d) => d.decision === "avoid")
  const entries = audit.decisions.filter((d) => d.decision !== "avoid").map((d) => vendorEntry(d, ctx, mappings))
  const blocked = entries.filter((e) => e.needsMapping).map((e) => e.originPath)
  return {
    schemaVersion: VENDOR_PLAN_SCHEMA,
    generatedAt,
    source,
    dryRun: true,
    canApply: blocked.length === 0 && entries.length > 0,
    counts: { planned: entries.length, excludedAvoid: avoid.length, needsMapping: blocked.length },
    excludedAvoid: avoid.map((d) => d.path).sort(),
    needsMapping: blocked.sort(),
    entries,
  }
}

/** Render markdown do plano (dry-run — nada foi escrito ainda). */
export function renderVendorPlanMarkdown(plan) {
  const c = plan.counts
  return [
    `# Plano de vendoring — ${plan.source}`, "",
    `Gerado: ${plan.generatedAt} · schema ${plan.schemaVersion}`, "",
    `**planned ${c.planned} · excluídas(avoid) ${c.excludedAvoid} · sem mapeamento ${c.needsMapping}** · aplicável: ${plan.canApply ? "sim" : "não"}`, "",
    "| Skill | Origem | Alvo | Mapeada? |", "|---|---|---|---|",
    ...plan.entries.map((e) => `| ${e.name} | ${e.originPath} | ${e.targetDir} | ${e.needsMapping ? "❌ falta gate+agente" : "✅"} |`),
    "",
    "Toda skill vendada nasce `advisory` (test: missing) — só vira enforced com teste próprio.", "",
  ].join("\n")
}
