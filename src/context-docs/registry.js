import { existsSync, readdirSync } from "fs"
import { join } from "path"

/**
 * Context docs: contexto documental versionado (ADR/PRD/plans/research).
 *
 * Princípio "porquê antes do como": o agente fica ciente da existência e
 * contagem dos docs SEM ler o conteúdo inteiro (economia de tokens). O registry
 * é puro/declarativo; quem injeta o resumo é o session_start (summary-only).
 */

export const SCHEMA_VERSION = 1

export const DOC_SOURCES = {
  adr: "docs/adr",
  prd: "docs/prd",
  plans: "docs/plans",
  research: "docs/research",
}

/** Registry declarativo escrito em .gstack/context.json. */
export function buildContextRegistry() {
  return {
    schemaVersion: SCHEMA_VERSION,
    sources: { ...DOC_SOURCES },
    db: ".gstack/context/context.db",
    sessionStart: {
      injectMode: "summary-only",
      maxDocsListed: 10,
    },
  }
}

/**
 * Conta os docs por categoria SEM ler conteúdo (apenas lista .md por dir).
 * @returns {{ adr:number, prd:number, plans:number, research:number, total:number }}
 */
export function countDocs(projectDir) {
  const counts = { adr: 0, prd: 0, plans: 0, research: 0, total: 0 }
  for (const [key, rel] of Object.entries(DOC_SOURCES)) {
    const dir = join(projectDir, rel)
    if (!existsSync(dir)) continue
    try {
      const n = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== ".gitkeep").length
      counts[key] = n
      counts.total += n
    } catch { /* dir ilegivel — conta 0 */ }
  }
  return counts
}

/** Resumo curto (uma linha) para injeção no session_start. */
export function summarizeDocs(projectDir) {
  const c = countDocs(projectDir)
  return `ADR ${c.adr} · PRD ${c.prd} · plans ${c.plans} · research ${c.research} (total ${c.total})`
}
