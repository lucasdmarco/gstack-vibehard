// @ts-check
/**
 * PRD51 S51.8.1 — taxonomia de validação (§51.8, ações 5/6/7).
 *
 * Defeito real que motivou o módulo: `prd50Readiness()` calculava
 * `fullyValidated = PENDING_CLAIMS.length === 0`, e `PENDING_CLAIMS` misturava
 * duas coisas incomparáveis — claims que esperam **rótulo humano** (chegáveis:
 * alguém rotula e a pendência fecha) com um claim `not_measurable_by_design`
 * (o overhead do EV0 DENTRO do harness, que o GStack estruturalmente nunca
 * observa). Somados, o segundo tornava `fullyValidated` **impossível**: mesmo
 * com toda a rotulagem humana feita, o número nunca chegaria a zero.
 *
 * O PRD chama isso de "pendência impossível" e manda tratar como limitação
 * explícita. Aqui as duas viram categorias separadas: `fullyValidated` passa a
 * depender SÓ do que é mensurável, e o não-observável sai declarado —
 * permanentemente visível, nunca contado como dívida.
 */
export const VALIDATION_TAXONOMY_SCHEMA = "gstack.validation-taxonomy.v1"

/**
 * `human_labeling` = alcançável por trabalho humano; conta para fullyValidated.
 * `not_measurable_by_design` = o sistema estruturalmente não observa o sinal;
 * NUNCA conta como pendência (não há trabalho que a feche).
 */
export const BLOCKED_BY_KINDS = Object.freeze(["human_labeling", "not_measurable_by_design"])

/**
 * PRD51 S51.8.3 — o §4.6 do PRD pede CINCO estados, não dois. `validated` e
 * `rejected` só são alcançáveis pelo pipeline de avaliação cega
 * (`blind-evaluation.js`); `outOfScope` é decisão declarada com motivo.
 * Reexportado daqui para que exista UMA fonte do vocabulário.
 */
export { CLAIM_STATES, resolveClaimState } from "./blind-evaluation.js"

const isUnobservable = (c) => c.blockedBy === "not_measurable_by_design"

/**
 * Toda categoria tem que ser conhecida. Um `blockedBy` novo e não classificado
 * seria contado como "mensurável" por omissão — exatamente o tipo de fail-open
 * que este programa vem eliminando. Por isso o desconhecido é REPORTADO.
 */
export function partitionClaims(claims = []) {
  const known = claims.filter((c) => BLOCKED_BY_KINDS.includes(c.blockedBy))
  return {
    pendingHumanValidation: known.filter((c) => !isUnobservable(c)),
    unobservableByDesign: known.filter(isUnobservable),
    unclassified: claims.filter((c) => !BLOCKED_BY_KINDS.includes(c.blockedBy)),
  }
}

/**
 * `fullyValidated` só sobre o que é mensurável (§51.8 ação 6).
 *
 * Fail-closed em duas frentes herdadas do S51.0C: sem nenhum claim
 * classificado não há evidência de validação (ausência ≠ completude), e
 * qualquer claim com categoria desconhecida derruba — não sabemos se é dívida.
 */
export function measurableValidationComplete(claims = []) {
  const { pendingHumanValidation, unobservableByDesign, unclassified } = partitionClaims(claims)
  const measurableTotal = pendingHumanValidation.length + unobservableByDesign.length
  if (unclassified.length > 0) return false
  if (measurableTotal === 0) return false
  return pendingHumanValidation.length === 0
}

/** Relatório legível: o que ainda dá trabalho fechar vs. o que nunca fecha. */
export function validationTaxonomy(claims = []) {
  const parts = partitionClaims(claims)
  return {
    schemaVersion: VALIDATION_TAXONOMY_SCHEMA,
    pendingHumanValidation: parts.pendingHumanValidation.map((c) => ({ claim: c.claim, missing: c.missing })),
    unobservableByDesign: parts.unobservableByDesign.map((c) => ({ claim: c.claim, reason: c.missing })),
    unclassified: parts.unclassified.map((c) => ({ claim: c.claim, blockedBy: c.blockedBy ?? null })),
    counts: {
      pendingHumanValidation: parts.pendingHumanValidation.length,
      unobservableByDesign: parts.unobservableByDesign.length,
      unclassified: parts.unclassified.length,
    },
    measurableValidationComplete: measurableValidationComplete(claims),
    note: "unobservableByDesign é limitação declarada, NÃO dívida: nenhum trabalho a fecha, então não pode travar fullyValidated",
  }
}
