/**
 * §26.1 executável — a mesma claim, vista por projeções diferentes (S52.D).
 *
 * DoD, blockers, Evidence Ledger, `proof`, closeout e matriz de RC são PROJEÇÕES
 * da mesma claim. Enquanto ninguém as compara, cada uma pode envelhecer no seu
 * canto: o auditor diz REAL, o recibo mostra que a evidência sumiu, e as duas
 * frases convivem no mesmo repositório sem se encontrarem.
 *
 * Este módulo faz elas se encontrarem. Para cada claim com contrato, monta um
 * registro de RECONCILIAÇÃO no schema do S52.A e aplica um veredito:
 *
 *   consistent  — o status afirma prova E a evidência exigida foi observada;
 *   not_proved  — o status não afirma prova (estado honesto, não falha);
 *   fail        — o status afirma prova e a evidência NÃO sustenta;
 *   inconclusive:claim_conflict — as projeções se contradizem sem adjudicação.
 *
 * O veredito nunca é escolhido por conveniência: `problemasDaReconciliacao` do
 * S52.A recusa um registro que declare `consistent` com evidência faltando, então
 * um veredito otimista não passa nem pela própria validação.
 */

import { claimId as canonico } from "../meta/claim-id.js"
import { problemasDaReconciliacao, CLAIM_RECONCILIATION_SCHEMA } from "../meta/prd52-schemas.js"
import { contractFor, NOT_PROVED } from "./claim-contract.js"
import { evidenciasDoContrato, driftDoRecibo } from "./claim-receipt.js"
import { leitorPadrao } from "./claim-contract-check.js"

export { CLAIM_RECONCILIATION_SCHEMA }

const iso = (d) => new Date(d).toISOString().slice(0, 10)

/** As evidências que o recibo REALMENTE observou (as ausentes não contam como observadas). */
const observadas = (receipt) => (receipt?.observedEvidenceRefs || [])
  .filter((r) => r.state === "observed")
  .map((r) => r.path)

/** A evidência não sustenta a afirmação: falta alguma, ou a que existe mudou. */
const semLastro = (faltando, drift) => faltando.length > 0 || drift.length > 0

/**
 * O veredito de UMA claim.
 *
 * A ordem importa e é deliberada: um conflito entre projeções é reconhecido
 * ANTES de qualquer conclusão sobre evidência, porque decidir o mérito enquanto
 * as fontes discordam é escolher uma delas em silêncio.
 */
function vereditoDe({ status, faltando, drift }) {
  // Uma claim rebaixada cuja evidência está inteira é um conflito: o auditor e o
  // recibo dizem coisas diferentes, e nenhum dos dois é autoridade sobre o
  // outro. Quem adjudica é humano.
  if (status === NOT_PROVED) return semLastro(faltando, drift) ? "not_proved" : "inconclusive:claim_conflict"
  if (status !== "REAL") return "not_proved"
  return semLastro(faltando, drift) ? "fail" : "consistent"
}

/** As opções normalizadas num lugar só, para a função principal ficar sobre o assunto dela. */
const opcoes = (o = {}) => ({ io: o.io || leitorPadrao(), commit: o.commit || null, agora: o.agora || Date.now() })

/** O commit do RECIBO manda: é dele a observação. O do chamador é só o fallback. */
const commitDaObservacao = (claim, commit) => (claim.receipt && claim.receipt.sourceCommit) || commit

/**
 * Reconcilia UMA claim do audit. Devolve o registro no schema do §26.1 mais os
 * problemas de validação — que precisam ser vazios, senão o próprio registro é
 * inválido e não vale como reconciliação.
 */
export function reconciliarClaim(claim, opts = {}) {
  const { io, commit, agora } = opcoes(opts)
  const contract = contractFor(claim.id)
  const requeridas = evidenciasDoContrato(contract)
  const vistas = observadas(claim.receipt)
  const faltando = requeridas.filter((p) => !vistas.includes(p))
  const drift = claim.receipt ? driftDoRecibo(claim.receipt, io) : []

  const registro = {
    schemaVersion: CLAIM_RECONCILIATION_SCHEMA,
    claimId: canonico("dream_audit", claim.id),
    sourceCommit: commitDaObservacao(claim, commit),
    requiredEvidenceRefs: requeridas,
    observedEvidenceRefs: vistas,
    ledgerStatus: claim.status,
    proofStatus: claim.receipt ? "receipt_present" : "receipt_absent",
    blockerStatus: claim.notProved ? "open" : "none",
    rcStatus: claim.severity || null,
    consistencyVerdict: vereditoDe({ status: claim.status, faltando, drift }),
    checkedAt: iso(agora),
  }
  return { registro, problemas: problemasDaReconciliacao(registro), missingEvidence: faltando, drift }
}

/**
 * Reconcilia o audit inteiro.
 *
 * Só entram claims COM contrato: reconciliar uma claim sem contrato compararia o
 * status contra uma lista de evidências vazia e devolveria `consistent` — um
 * verde produzido pela ausência de exigência, que é o pior tipo.
 */
export function reconciliarAudit(auditResult, opts = {}) {
  const claims = (auditResult?.claims || []).filter((c) => contractFor(c.id))
  const itens = claims.map((c) => ({ id: c.id, ...reconciliarClaim(c, opts) }))
  const porVeredito = {}
  for (const i of itens) {
    const v = i.registro.consistencyVerdict
    porVeredito[v] = (porVeredito[v] || 0) + 1
  }
  const invalidos = itens.filter((i) => i.problemas.length > 0)
  return {
    schemaVersion: CLAIM_RECONCILIATION_SCHEMA,
    total: itens.length,
    byVerdict: porVeredito,
    // Um registro que não passa na própria validação NÃO é reconciliação: é dado
    // malformado se passando por prova, e aparece separado por isso.
    invalidRecords: invalidos.map((i) => ({ id: i.id, problems: i.problemas })),
    ok: invalidos.length === 0 && !porVeredito.fail,
    items: itens,
  }
}
