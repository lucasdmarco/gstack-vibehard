import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { buildProjections, projectionDriftStatus, detectHumanEdit, reconciliationPlan } from "./design-context.js"

/**
 * PRD51 S51.7.5 — persistência + consumo real do design context.
 *
 * Achado que motivou o módulo: `design-context.js` (PRD49 S49.1) é real,
 * puro e testado — mas o ÚNICO chamador de `buildProjections` em todo o
 * `src/` era `start.js` dentro de `dryRunReport()`. Ou seja: as projeções
 * (`PRODUCT.md`/`DESIGN.md`/`.impeccable/design.json`) só eram CALCULADAS
 * pra um preview de `--dry-run`, nunca escritas, nunca reconciliadas, e o
 * design gate nunca consultava `projectionDriftStatus`. Duas ilhas.
 *
 * Este módulo é a ponte, e mantém `design-context.js` PURO (todo o I/O
 * mora aqui). Invariante central herdada do próprio PRD49: **edição humana
 * NUNCA é sobrescrita em silêncio** — quando o conteúdo em disco diverge do
 * que o GStack geraria, devolve `reconciliationPlan` em vez de escrever.
 */
export const DESIGN_CONTEXT_SYNC_SCHEMA = "gstack.design-context-sync.v1"

const provenancePath = (cwd) => join(cwd, ".gstack", "design-context.json")

/** Proveniência da última sincronização (sourceHash + quando). Ausente/ilegível -> null. */
export function readSyncProvenance(cwd) {
  const p = provenancePath(cwd)
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8"))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch { return null }
}

/**
 * Estado do design context SEM escrever nada (read-only, seguro pra gate).
 * @returns {{status:"absent"|"fresh"|"stale", sourceHash, lastSourceHash}}
 */
export function designContextStatus({ cwd, ds, brief = null } = {}) {
  const projections = buildProjections({ ds, brief })
  const prov = readSyncProvenance(cwd)
  const lastSourceHash = prov?.sourceHash || null
  return {
    schemaVersion: DESIGN_CONTEXT_SYNC_SCHEMA,
    status: projectionDriftStatus(lastSourceHash, projections.sourceHash),
    sourceHash: projections.sourceHash,
    lastSourceHash,
    files: Object.keys(projections.files),
  }
}

// Uma projeção só é escrita quando o disco NÃO tem edição humana. Comparamos
// contra o que o GStack teria gerado da ÚLTIMA vez — se o arquivo em disco é
// diferente disso, alguém editou à mão e a decisão volta pro humano.
// Sem registro do que geramos antes, qualquer arquivo preexistente é tratado
// como possivelmente humano — conservador de propósito.
const isHumanAuthored = (onDisk, previous) => previous === undefined || detectHumanEdit(onDisk, previous)

function actionFor(onDisk, content, previous) {
  if (onDisk === null) return "create"
  if (isHumanAuthored(onDisk, previous)) return "reconcile"
  return onDisk === content ? "unchanged" : "update"
}

function planFor(cwd, relPath, content, lastGenerated) {
  const abs = join(cwd, relPath)
  const onDisk = existsSync(abs) ? readFileSync(abs, "utf-8") : null
  return { file: relPath, action: actionFor(onDisk, content, lastGenerated?.[relPath]), abs, content, onDisk }
}

/**
 * Sincroniza as projeções em disco. `apply:false` (default) é um PLANO —
 * nada é escrito. Arquivo com edição humana nunca é sobrescrito: entra como
 * `reconcile` com o plano de 3 vias do PRD49.
 */
export function syncDesignContext({ cwd, ds, brief = null, apply = false } = {}) {
  const projections = buildProjections({ ds, brief })
  const prov = readSyncProvenance(cwd)
  const plans = Object.entries(projections.files).map(([rel, content]) => planFor(cwd, rel, content, prov?.generated))
  const conflicts = plans.filter((p) => p.action === "reconcile")
  const writable = plans.filter((p) => p.action === "create" || p.action === "update")
  const result = {
    schemaVersion: DESIGN_CONTEXT_SYNC_SCHEMA,
    sourceHash: projections.sourceHash,
    applied: false,
    plans: plans.map(({ file, action }) => ({ file, action })),
    conflicts: conflicts.map((c) => reconciliationPlan({ canonical: projections.sourceHash, existingOnDisk: c.file, freshlyGenerated: c.file })),
  }
  if (!apply) return result
  for (const p of writable) {
    mkdirSync(dirname(p.abs), { recursive: true })
    writeFileSync(p.abs, p.content)
  }
  // Proveniência guarda o conteúdo gerado — é o que permite distinguir, na
  // próxima vez, "o usuário editou" de "o canônico mudou".
  const generated = Object.fromEntries(plans.filter((p) => p.action !== "reconcile").map((p) => [p.file, projections.files[p.file]]))
  mkdirSync(join(cwd, ".gstack"), { recursive: true })
  writeFileSync(provenancePath(cwd), JSON.stringify({
    schemaVersion: DESIGN_CONTEXT_SYNC_SCHEMA,
    sourceHash: projections.sourceHash,
    syncedAt: new Date().toISOString(),
    generated,
  }, null, 2) + "\n")
  return { ...result, applied: true, written: writable.map((p) => p.file) }
}
