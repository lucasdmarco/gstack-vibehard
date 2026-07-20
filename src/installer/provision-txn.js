import { mkdirSync, appendFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"

/**
 * PRD45 S45.5 (P1.7/P1.8) — transação de PROVISIONAMENTO para recursos não-arquivo.
 *
 * O `InstallJournal` (journal.js) já torna as ESCRITAS de arquivo tudo-ou-restaura, mas em
 * MEMÓRIA e só para file/mkdir. O Full provisiona muito além disso — container Casdoor,
 * globais (~/.atomic), processos de rede — e uma falha tardia deixava a máquina suja,
 * terminando em `partial_with_restore_available` com restore MANUAL. Aqui:
 *   • um OPERATION PLAN único que o dry-run DESCREVE e o executor RODA (P1.8: consentimento
 *     informado — cada op expõe kind/scope/reason/rede/pacote/versão/rollback);
 *   • journal WRITE-AHEAD em DISCO (crash-safe, ao contrário do InstallJournal em memória);
 *   • compensação automática em ORDEM REVERSA quando uma op falha (cada op tem compensate);
 *   • ownership por recurso: a op que FALHOU não é compensada (não chegou a aplicar);
 *   • estados finais `committed | rolled_back | rollback_failed`;
 *   • recovery: `recoverPlan` compensa o que um processo morto deixou aplicado-sem-commit.
 *
 * Complementa (não substitui) `operation-plan.js`/`journal.js`: uma op de arquivo pode
 * delegar seu apply/compensate ao InstallJournal; containers/globais/processos ganham aqui a
 * cobertura transacional que faltava. PURO/injetável.
 */

export const PROVISION_TXN_SCHEMA = "gstack.provision-txn.v1"
export const JOURNAL_FILE = "operation-journal.jsonl"

const writeAhead = (journalPath, event) =>
  appendFileSync(journalPath, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n", "utf-8")

/**
 * Descrição FIEL do plano para o dry-run — expõe kind/scope/reason/rollback/network/package/
 * version SEM executar nada (consentimento informado, P1.8). Nunca chama apply/compensate.
 */
const rollbackDesc = (o) => o.rollbackDesc || (o.compensate ? `compensador de ${o.id}` : "sem rollback")
// Defaults por campo; os presentes na op sobrescrevem (evita uma cadeia de `||` = cc alta).
const OP_DEFAULTS = Object.freeze({ kind: "file", scope: "project", reason: null, network: null, package: null, version: null })
function definedFields(o) {
  const out = {}
  for (const k of Object.keys(OP_DEFAULTS)) if (o[k] != null) out[k] = o[k]
  return out
}
// Ordem de chaves preservada (o golden compara o JSON literal): id/kind/description/scope/
// reason/network/package/version/rollback.
const describeOp = (o) => {
  const d = { ...OP_DEFAULTS, ...definedFields(o) }
  return { id: o.id, kind: d.kind, description: o.description || o.id, scope: d.scope, reason: d.reason, network: d.network, package: d.package, version: d.version, rollback: rollbackDesc(o) }
}
export function describePlan(ops = []) {
  return ops.map(describeOp)
}

// Compensa em ORDEM REVERSA. Um compensador que lança NÃO aborta os demais (rollback
// best-effort), mas coleta o erro → o estado final vira rollback_failed.
function rollback(applied, ctx, journalPath, invoke) {
  const errors = []
  for (const o of [...applied].reverse()) {
    writeAhead(journalPath, { event: "compensate_started", id: o.id })
    try { invoke(o, ctx); writeAhead(journalPath, { event: "compensated", id: o.id }) }
    catch (e) { errors.push({ id: o.id, error: String(e.message || e) }); writeAhead(journalPath, { event: "compensate_failed", id: o.id, error: String(e.message || e) }) }
  }
  return errors
}

function finish(journalPath, state, extra) {
  writeAhead(journalPath, { event: "plan_ended", state })
  return { schema: PROVISION_TXN_SCHEMA, state, ...extra }
}

// Falha de uma op: compensa as aplicadas e devolve o resultado tipado.
function onOpFailure(o, err, applied, ctx, journalPath) {
  writeAhead(journalPath, { event: "op_failed", id: o.id, error: String(err.message || err) })
  const rollbackErrors = rollback(applied, ctx, journalPath, (op, c) => op.compensate(c))
  const state = rollbackErrors.length ? "rollback_failed" : "rolled_back"
  return finish(journalPath, state, { applied: applied.map((a) => a.id), failedOp: o.id, error: String(err.message || err), rollbackErrors })
}

/**
 * Executa o plano transacionalmente. @returns { state, applied, failedOp?, rollbackErrors? }.
 * `opts.simulateCrashAfterApply` (teste): aplica tudo mas NÃO grava commit — deixa o journal
 * no estado que um crash real deixaria, para exercitar `recoverPlan`.
 */
export async function executePlan(ops = [], opts = {}) {
  const journalDir = opts.journalDir || process.cwd()
  mkdirSync(journalDir, { recursive: true })
  const journalPath = join(journalDir, JOURNAL_FILE)
  const ctx = opts.ctx || {}
  writeAhead(journalPath, { event: "plan_started", count: ops.length })

  const applied = []
  for (const o of ops) {
    const err = await applyOne(o, ctx, journalPath, applied)
    if (err) return onOpFailure(o, err, applied, ctx, journalPath)
  }
  if (opts.simulateCrashAfterApply) return { schema: PROVISION_TXN_SCHEMA, state: "crashed_uncommitted", applied: applied.map((a) => a.id) }
  return finish(journalPath, "committed", { applied: applied.map((a) => a.id) })
}
// Aplica UMA op com write-ahead. @returns o erro (para rollback) ou null em sucesso.
async function applyOne(o, ctx, journalPath, applied) {
  writeAhead(journalPath, { event: "op_started", id: o.id, kind: o.kind || "file" }) // WRITE-AHEAD
  try {
    await o.apply(ctx)
    applied.push(o)
    writeAhead(journalPath, { event: "op_applied", id: o.id })
    return null
  } catch (e) { return e }
}

// Lê o journal e devolve os ids APLICADOS que não foram compensados, e se houve commit.
const parseJsonl = (text) => text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
function pendingFromJournal(journalPath) {
  if (!existsSync(journalPath)) return { committed: false, appliedIds: [] }
  const events = parseJsonl(readFileSync(journalPath, "utf-8"))
  const applied = events.filter((e) => e.event === "op_applied").map((e) => e.id)
  const compensated = new Set(events.filter((e) => e.event === "compensated").map((e) => e.id))
  const committed = events.some((e) => e.event === "plan_ended" && e.state === "committed")
  return { committed, appliedIds: applied.filter((id) => !compensated.has(id)) }
}

/**
 * Recovery após crash (chamado pelo doctor): journal com ops aplicadas SEM commit ⇒ compensa em
 * ordem reversa usando `compensators` (id→fn). Já commitado / nada pendente = no-op. @returns
 * { state: "rolled_back"|"rollback_failed"|"nothing_to_recover", recovered }.
 */
export async function recoverPlan({ journalDir = process.cwd(), compensators = {} } = {}) {
  const journalPath = join(journalDir, JOURNAL_FILE)
  const { committed, appliedIds } = pendingFromJournal(journalPath)
  if (committed || appliedIds.length === 0) return { schema: PROVISION_TXN_SCHEMA, state: "nothing_to_recover", recovered: [] }
  const pseudoOps = appliedIds.map((id) => ({ id, compensate: (c) => (compensators[id] ? compensators[id](c) : undefined) }))
  const errors = rollback(pseudoOps, {}, journalPath, (op, c) => op.compensate(c))
  const state = errors.length ? "rollback_failed" : "rolled_back"
  return finish(journalPath, state, { recovered: appliedIds, rollbackErrors: errors })
}
