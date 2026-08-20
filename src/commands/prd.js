import { PRD45_RC_ITEMS } from "../dream/rc-checklist-prd45.js"
import { PRD46_RC_ITEMS } from "../dream/rc-checklist-prd46.js"
import { PRD47_RC_ITEMS } from "../dream/rc-checklist-prd47.js"
import { PRD48_RC_ITEMS } from "../dream/rc-checklist-prd48.js"
import { PRD49_RC_ITEMS } from "../dream/rc-checklist-prd49.js"
import { PRD50_RC_ITEMS } from "../dream/rc-checklist-prd50.js"
import { PRD51_RC_ITEMS, prd51Readiness } from "../dream/rc-checklist-prd51.js"
import { PRD52_RC_ITEMS, prd52Readiness } from "../dream/rc-checklist-prd52.js"
import { projectPrdLedger } from "../dream/prd-ledger.js"
import { buildEvidencePack, problemasDoPack, gravarPack } from "../dream/prd52-evidence-pack.js"
import { construirSeedCorpus, problemasDoCorpus } from "../dream/prd53-seed-corpus.js"
import { construirPendenciasExternas, problemasDasPendencias, gravarPendencias } from "../release/external-pending.js"
import { inventarioDosManuais, problemasDoInventario } from "../dream/prd53-manual-inventory.js"
import { manifestDeReferencias, problemasDoManifest } from "../dream/prd53-external-refs.js"
import { prd53EntryGate } from "../dream/prd53-entry-gate.js"
import { rcMatrixVerdict } from "../release/rc-matrix.js"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createHash } from "node:crypto"
import { section, info, warn, error, success } from "../cli/index.js"

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

const SEED_CORPUS_PATH = join(".docs", "RESEARCH", "prd53-seed-corpus.json")

/**
 * `prd evidence [--write]` — gera o evidence pack do PRD52 e o seed corpus do
 * PRD53.
 *
 * ESCREVE, e por isso a flag é explícita: sem `--write` o comando só mostra o
 * que geraria. Escrever em `.gstack/` e `.docs/` é `write_project_state` — o
 * firewall separa isso de editar código-fonte, e nenhuma linha de produto é
 * tocada aqui.
 *
 * Um pack inválido NUNCA é gravado. Gravar primeiro e validar depois deixaria no
 * disco um artefato que o portão do PRD53 aceitaria pelo caminho e recusaria
 * pelo conteúdo — pior que não ter artefato nenhum.
 */
function evidenceCmd(ctx) {
  const commit = resolveHeadCommit(ctx.root || ctx.cwd)
  const pack = buildEvidencePack({ repoRoot: ctx.cwd, commit })
  const corpus = construirSeedCorpus()
  // S52.K: o runbook das pendências EXTERNAS sai junto. Elas não fecham aqui, e
  // por isso mesmo precisam sobreviver à sessão — quem for executar em outra
  // máquina, noutro dia, não tem esta conversa.
  const pendencias = construirPendenciasExternas({ cwd: ctx.cwd, commit })
  // S53.0 (§19): o inventário dos manuais e o manifest de referências externas.
  // Os dois CATALOGAM e nunca promovem — a regra viaja dentro do artefato.
  const inventario = inventarioDosManuais({ repoRoot: ctx.cwd, commit })
  const referencias = manifestDeReferencias({ repoRoot: ctx.cwd, commit })
  const problemas = [
    ...problemasDoPack(pack).map((x) => `evidence-pack: ${x}`),
    ...problemasDoCorpus().map((x) => `seed-corpus: ${x}`),
    ...problemasDasPendencias(pendencias).map((x) => `external-pending: ${x}`),
    ...problemasDoInventario(inventario).map((x) => `manual-inventory: ${x}`),
    ...problemasDoManifest(referencias).map((x) => `external-refs: ${x}`),
  ]
  const escrever = ctx.args.includes("--write") && problemas.length === 0
  const escritos = escrever
    ? [
      gravarPack(pack, { repoRoot: ctx.cwd }), gravarCorpus(corpus, ctx.cwd),
      gravarPendencias(pendencias, { cwd: ctx.cwd }),
      gravarJson(inventario, join(".docs", "RESEARCH", "prd53-manual-inventory.json"), ctx.cwd),
      gravarJson(referencias, join(".docs", "RESEARCH", "prd53-external-refs.json"), ctx.cwd),
    ]
    : []
  if (problemas.length) process.exitCode = 1

  const saida = { schemaVersion: pack.schemaVersion, commit, problems: problemas, written: escritos, pack, corpus, pendencias, inventario, referencias }
  if (ctx.json) { process.stdout.write(JSON.stringify(saida) + "\n"); return saida }
  renderEvidence(saida, escrever)
  return saida
}

function renderEvidence({ problems, written, pack }, escrever) {
  section("prd evidence — evidence pack do PRD52 + seed corpus do PRD53")
  for (const x of problems) error(`  ${x}`)
  if (!problems.length && !escrever) info("  válidos; use --write para gravar.")
  for (const w of written) success(`  gravado: ${w.path} (${w.sha256.slice(0, 20)}…)`)
  info(`  placar ${JSON.stringify(pack.scoreboard)} · ${pack.claims.length} claim(s) com recibo`)
  for (const n of pack.notMeasured) warn(`  NÃO medido: ${n.claim} — ${n.why}`)
}

/** Grava um artefato JSON e devolve caminho + hash do que foi escrito. */
function gravarJson(doc, rel, cwd) {
  const destino = join(cwd, rel)
  mkdirSync(dirname(destino), { recursive: true })
  const texto = `${JSON.stringify(doc, null, 2)}\n`
  writeFileSync(destino, texto)
  return { path: rel, sha256: `sha256:${createHash("sha256").update(texto).digest("hex")}` }
}

const gravarCorpus = (corpus, cwd) => gravarJson(corpus, SEED_CORPUS_PATH, cwd)

/**
 * `prd gate` — o portão de entrada do PRD53, read-only.
 *
 * Sai com código 1 quando bloqueado: quem chama de script precisa distinguir
 * "pode começar" de "não pode" sem ler prosa.
 */
function gateCmd(ctx) {
  const g = prd53EntryGate({ repoRoot: ctx.cwd, commit: resolveHeadCommit(ctx.root || ctx.cwd) })
  if (!g.entered) process.exitCode = 1
  if (ctx.json) { process.stdout.write(JSON.stringify(g) + "\n"); return g }
  section(`prd gate — entrada do PRD53 (§2): ${g.status}`)
  for (const c of g.criteria) {
    const linha = `  ${c.id} [${c.state}] — ${c.detail}`
    ;(c.state === "met" ? info : warn)(linha)
  }
  info(`  ${g.note}`)
  return g
}

/** HEAD real do repositório auditado. Sem git disponível, `null` honesto. */
function resolveHeadCommit(root) {
  try { return String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: "pipe", encoding: "utf-8", timeout: 20000 }) || "").trim() || null }
  catch { return null }
}

/**
 * Os subcomandos. Tabela única: o comando virou despachante fino, e cada
 * subcomando responde por si.
 *
 * A versão anterior tinha DUAS listas — um `SUBCOMMANDS` só para dizer "existe"
 * e o corpo do comando implementando `status` inline. Duas fontes sobre a mesma
 * coisa é o defeito que este repositório passou o PRD52 inteiro removendo dos
 * outros lugares.
 */
const HANDLERS = Object.freeze({ status: statusCmd, evidence: evidenceCmd, gate: gateCmd })

function statusCmd({ cwd, json }) {
  const report = buildPrdStatusReport(cwd)
  const dod = buildDoDSummary()
  const rcMatrix = rcMatrixVerdict()
  // O HEAD é resolvido pelo COMANDO, nunca pelo checklist — mesma divisão que o
  // `dream audit` já usa. E não é formalidade: medir sem commit produz recibos
  // sem proveniência, e o §26.1 recusa TODO registro nesse estado. Foi o que
  // aconteceu na primeira fiação deste comando — 24 registros inválidos de uma
  // vez, e `ready:false` por um defeito da medição, não do repositório.
  const prd52 = prd52Readiness(undefined, { repoRoot: cwd, commit: resolveHeadCommit(cwd) })
  const saida = { programs: report, dod, rcMatrix, prd52 }
  if (json) { process.stdout.write(JSON.stringify({ schemaVersion: PRD_STATUS_REPORT_SCHEMA, ...saida }) + "\n"); return saida }
  renderStatus(report, dod, rcMatrix, prd52)
  return saida
}

function subcomandoDesconhecido(json) {
  if (json) { process.stdout.write(JSON.stringify({ error: "subcomando desconhecido — use `prd status`" }) + "\n"); return { error: true } }
  error("Subcomando desconhecido. Use: gstack_vibehard prd status|evidence|gate [--json]")
  return { error: true }
}

export async function prdCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const ctx = { args, json, cwd, root: opts.root || cwd }
  const handler = HANDLERS[args[0]]
  return handler ? handler(ctx) : subcomandoDesconhecido(json)
}
