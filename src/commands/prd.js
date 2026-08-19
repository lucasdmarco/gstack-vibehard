import { PRD45_RC_ITEMS } from "../dream/rc-checklist-prd45.js"
import { PRD46_RC_ITEMS } from "../dream/rc-checklist-prd46.js"
import { PRD47_RC_ITEMS } from "../dream/rc-checklist-prd47.js"
import { PRD48_RC_ITEMS } from "../dream/rc-checklist-prd48.js"
import { PRD49_RC_ITEMS } from "../dream/rc-checklist-prd49.js"
import { PRD50_RC_ITEMS } from "../dream/rc-checklist-prd50.js"
import { PRD51_RC_ITEMS, prd51Readiness } from "../dream/rc-checklist-prd51.js"
import { PRD52_RC_ITEMS, prd52Readiness } from "../dream/rc-checklist-prd52.js"
import { projectPrdLedger } from "../dream/prd-ledger.js"
import { rcMatrixVerdict } from "../release/rc-matrix.js"
import { execFileSync } from "node:child_process"
import { section, info, warn, error } from "../cli/index.js"

/**
 * `prd status` — ledger unificado de PRDs (PRD51 S51.3). Agrega os checklists
 * canônicos de PRD45-PRD50 (cada `rc-checklist-prdXX.js`) e projeta cada um no
 * schema comum (`prd-ledger.js`, que reusa `release/baseline.js`). READ-ONLY:
 * só lê os arrays de item e os arquivos de prova em disco, nunca edita fonte.
 */
export const PRD_STATUS_REPORT_SCHEMA = "gstack.prd-status-report.v1"

const PROGRAMS = Object.freeze([
  { prdId: "PRD45", items: PRD45_RC_ITEMS },
  { prdId: "PRD46", items: PRD46_RC_ITEMS },
  { prdId: "PRD47", items: PRD47_RC_ITEMS },
  { prdId: "PRD48", items: PRD48_RC_ITEMS },
  { prdId: "PRD49", items: PRD49_RC_ITEMS },
  { prdId: "PRD50", items: PRD50_RC_ITEMS },
  // PRD51 S51.10.1: o programa de FECHAMENTO era o único fora do próprio ledger — quem
  // audita os outros não se auditava.
  { prdId: "PRD51", items: PRD51_RC_ITEMS },
  // PRD52 S52.H: mesmo motivo do S51.10.1 — o programa que endureceu as réguas
  // dos outros não pode ficar de fora da régua.
  { prdId: "PRD52", items: PRD52_RC_ITEMS },
])

/** Constrói o ledger de todos os programas conhecidos. Puro/testável (cwd injetável). */
export function buildPrdStatusReport(cwd = process.cwd()) {
  return PROGRAMS.map((p) => projectPrdLedger({ prdId: p.prdId, items: p.items, repoRoot: cwd }))
}

/**
 * PRD51 S51.10.1 — o DoD do §9 é específico do PRD51 e NÃO cabe no schema comum do ledger
 * (que fala de itens de sprint). Sai como bloco próprio, porque uma pendência que ninguém
 * enxerga não é uma pendência: é uma omissão com boa aparência.
 */
export function buildDoDSummary() {
  const r = prd51Readiness()
  return {
    ready: r.ready,
    programComplete: r.programComplete,
    satisfied: r.counts.dodSatisfied,
    total: r.counts.dod,
    open: r.openDoD,
  }
}

function statusIcon(p) {
  if (p.violations.length) return "✗"
  return p.programComplete && p.operationallyProven && p.fullyValidated ? "✓" : "•"
}

function renderProgram(p) {
  info(`  ${statusIcon(p)} ${p.prdId}: programComplete=${p.programComplete} operationallyProven=${p.operationallyProven} fullyValidated=${p.fullyValidated} residuals=${p.residuals.length} nonGoals=${p.nonGoals.length}`)
  if (p.violations.length) warn(`     violação: ${p.violations.map((v) => `${v.id} (${v.reason})`).join("; ")}`)
}

function renderDoD(dod) {
  info("")
  info(`  DoD do PRD51 (§9): ${dod.satisfied}/${dod.total} satisfeitas — programComplete=${dod.programComplete}`)
  for (const d of dod.open) warn(`     ${d.id} [${d.kind}/${d.status}] ${d.requirement} — falta: ${d.missing}`)
}

// S51.10.2 — a matriz do §51.10 sai junto pelo mesmo motivo do DoD: um registro que só
// existe no código-fonte não conduz um RC. Cada lacuna vem com o motivo, nunca só a conta.
function renderMatrix(m) {
  info("")
  info(`  Matriz RC (§51.10): ${m.counts.proven}/${m.counts.total} provadas — complete=${m.complete}`)
  for (const d of m.open) warn(`     ${d.id} [${d.status}] ${d.dimension} — ${d.gap}`)
}

/**
 * PRD52 S52.H — as pendências EXTERNAS saem nomeadas.
 *
 * Elas não são itens de sprint e não aparecem em `residuals`: nenhuma se fecha
 * com trabalho neste repositório. Omiti-las por isso faria o ledger mostrar um
 * programa redondo e calar exatamente o que falta.
 */
function renderPrd52(r) {
  const m = r.measurements
  info("")
  info(`  PRD52 (§25/§26): ready=${r.ready} fullyValidated=${r.fullyValidated} — placar ${JSON.stringify(m.scoreboard)}`)
  info(`     matriz OS×Node ${m.supportMatrix.proven}/${m.supportMatrix.total} provadas · hooks do Codex enforcementObserved=${m.codexHooks.enforcementObserved}`)
  for (const e of r.externalPending) warn(`     ${e.id} [${e.blockedBy}] — ${e.missing}`)
}

function renderStatus(report, dod, matrix, prd52) {
  section("prd status — ledger unificado (PRD45-PRD52)")
  for (const p of report) renderProgram(p)
  renderDoD(dod)
  renderMatrix(matrix)
  renderPrd52(prd52)
}

/** HEAD real do repositório auditado. Sem git disponível, `null` honesto. */
function resolveHeadCommit(root) {
  try { return String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: "pipe", encoding: "utf-8", timeout: 20000 }) || "").trim() || null }
  catch { return null }
}

const SUBCOMMANDS = Object.freeze({ status: true })

export async function prdCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args[0]
  if (!SUBCOMMANDS[sub]) {
    if (json) { process.stdout.write(JSON.stringify({ error: "subcomando desconhecido — use `prd status`" }) + "\n"); return { error: true } }
    error("Subcomando desconhecido. Use: gstack_vibehard prd status [--json]")
    return { error: true }
  }
  const report = buildPrdStatusReport(cwd)
  const dod = buildDoDSummary()
  const rcMatrix = rcMatrixVerdict()
  // O HEAD é resolvido pelo COMANDO, nunca pelo checklist — mesma divisão que o
  // `dream audit` já usa. E não é formalidade: medir sem commit produz recibos
  // sem proveniência, e o §26.1 recusa TODO registro nesse estado. Foi o que
  // aconteceu na primeira fiação deste comando — 24 registros inválidos de uma
  // vez, e `ready:false` por um defeito da medição, não do repositório.
  const prd52 = prd52Readiness(undefined, { repoRoot: cwd, commit: resolveHeadCommit(cwd) })
  if (json) { process.stdout.write(JSON.stringify({ schemaVersion: PRD_STATUS_REPORT_SCHEMA, programs: report, dod, rcMatrix, prd52 }) + "\n"); return { programs: report, dod, rcMatrix, prd52 } }
  renderStatus(report, dod, rcMatrix, prd52)
  return { programs: report, dod, rcMatrix, prd52 }
}
