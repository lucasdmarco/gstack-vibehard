/**
 * PRD49 S49.1 — bridge de contexto de design. GStack JÁ é dono de `.gstack/
 * design-system.json` (`design-system.js`) e do Product Brief v2 (PRD47 S47.2) — este
 * módulo só PROJETA esses artefatos canônicos em `PRODUCT.md`/`DESIGN.md`/
 * `.impeccable/design.json` (formato compatível com o Impeccable, sem criar uma segunda
 * autoridade de design). Uma decisão canônica produz TODAS as projeções, com hash
 * determinístico — permite detectar drift antes de qualquer trabalho de UI. Projeção
 * editada por humano NUNCA é sobrescrita silenciosamente — sempre vira um plano de
 * reconciliação de 3 vias.
 */
import { createHash } from "node:crypto"

export const DESIGN_CONTEXT_SCHEMA = "gstack.design-context.v1"

function sha256(text) {
  return "sha256:" + createHash("sha256").update(text).digest("hex")
}

function buildProductMd(brief) {
  return [
    "# Product", "",
    brief?.objective || "(sem objetivo declarado — nenhum Product Brief canônico ainda)",
    "",
    "<!-- gerado pelo GStack a partir do Product Brief canônico (.gstack/plans/*/brief.json) — não editar diretamente; use `design context reconcile`. -->",
  ].join("\n")
}

const designMdLine = (ds) => {
  if (ds.status === "bypassed") return "Design system: opt-out explícito (`--design-system none`) — qualidade de design NÃO foi validada."
  if (ds.direction) return `Direção: ${ds.direction}`
  return `Design system: ${ds.status}`
}

function buildDesignMd(ds) {
  return [
    "# Design", "",
    designMdLine(ds), "",
    "<!-- gerado pelo GStack a partir do estado canônico .gstack/design-system.json — não editar diretamente; use `design context reconcile`. -->",
  ].join("\n")
}

function buildImpeccableDesignJson(ds) {
  return JSON.stringify({
    schemaVersion: "impeccable-compat.v1",
    tokens: ds.tokens || null,
    direction: ds.direction || null,
    generatedFrom: "gstack.design-system.v2",
  }, null, 2) + "\n"
}

const isValidCanonicalDs = (ds) => Boolean(ds && typeof ds === "object")
const briefField = (brief, key) => (brief ? brief[key] : null)
const sourceHashFor = (ds, brief) => sha256(JSON.stringify({ ds, briefObjective: briefField(brief, "objective"), briefDirection: briefField(brief, "designDirection") }))

/**
 * Monta as 3 projeções + proveniência (hash/schema/geração/app dono, monorepo). Uma
 * decisão canônica (`ds` + `brief`) produz sempre o MESMO `sourceHash` — é isso que
 * permite detectar drift depois. `ds` ausente/inválido lança — nunca projeta estado
 * canônico corrompido.
 */
export function buildProjections({ ds, brief = null, owningApp = null } = {}) {
  if (!isValidCanonicalDs(ds)) throw new Error("design-context: artefato canônico (design-system.json) ausente ou malformado")
  const sourceHash = sourceHashFor(ds, brief)
  return {
    schemaVersion: DESIGN_CONTEXT_SCHEMA,
    sourceHash,
    generatedAt: new Date().toISOString(),
    owningApp,
    files: {
      "PRODUCT.md": buildProductMd(brief),
      "DESIGN.md": buildDesignMd(ds),
      ".impeccable/design.json": buildImpeccableDesignJson(ds),
    },
  }
}

/** absent (nunca gerado) | fresh (hash bate) | stale (canônico mudou desde a geração). */
export function projectionDriftStatus(existingSourceHash, currentSourceHash) {
  if (!existingSourceHash) return "absent"
  return existingSourceHash === currentSourceHash ? "fresh" : "stale"
}

/** O conteúdo em disco diverge do que o GStack teria gerado? Nunca existiu -> não é edição humana. */
export function detectHumanEdit(diskContent, generatedContent) {
  return diskContent !== null && diskContent !== generatedContent
}

/** Edição humana detectada -> plano de reconciliação de 3 vias, nunca sobrescrita silenciosa. */
export function reconciliationPlan({ canonical, existingOnDisk, freshlyGenerated } = {}) {
  return { schemaVersion: DESIGN_CONTEXT_SCHEMA, action: "reconciliation_required", canonical, existingOnDisk, freshlyGenerated }
}
