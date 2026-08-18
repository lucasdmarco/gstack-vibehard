/**
 * O BASELINE da régua nova (PRD52 S52.B) — antes, depois e motivo por claim.
 *
 * Endurecer um gate sem registrar o que ele derrubou deixa duas leituras
 * possíveis do placar meses depois: "sempre foi assim" ou "alguma coisa
 * regrediu". Nenhuma das duas é verdade, e nenhuma é recuperável do git sem
 * arqueologia. Este módulo grava a transição UMA vez e depois a verifica
 * continuamente contra a medição ao vivo.
 *
 * A regra que ele impõe é a que interessa: um contrato novo que não sobrevive à
 * verificação NÃO pode entrar em silêncio. Ou passa nos dentes, ou aparece aqui
 * com motivo escrito por um humano. Não há terceira porta — e em particular não
 * há grandfathering, que é a porta que transforma gate em decoração.
 */

import { CLAIM_CONTRACTS, hasBehavioralContract } from "./claim-contract.js"
import { contratoComDentes, problemasDoContrato } from "./claim-contract-check.js"

export const TEETH_BASELINE_SCHEMA = "gstack.claim-teeth-baseline.v1"

/**
 * A transição medida quando a régua entrou.
 *
 * `antes` é a régua do PRD41 (os quatro campos *truthy*); `depois` é a régua do
 * S52.B (verificação executável contra o repo auditado). A diferença é UMA
 * claim, e ela caiu por um motivo concreto, não por endurecimento genérico.
 */
export const TEETH_BASELINE = Object.freeze({
  schemaVersion: TEETH_BASELINE_SCHEMA,
  sprint: "S52.B",
  antes: Object.freeze({ regra: "campos truthy (PRD41 S41.9)", comContrato: 24, semContrato: 0 }),
  depois: Object.freeze({ regra: "verificação executável (PRD52 S52.B)", comDentes: 23, semDentes: 1 }),

  /**
   * As claims que a régua nova derruba, com o motivo. NOT_PROVED aqui é estado
   * honesto: a capacidade existe e tem teste: o que não existe é a prova E2E que
   * o contrato afirmava ter.
   */
  quedas: Object.freeze({
    "action-kernel": [
      "e2e_executavel: o campo declarava `runGovernedAction (task/workflow/delegate)`,",
      "que é um NOME DE FUNÇÃO, não um comando. O controle negativo",
      "(tests/action_kernel_governed.test.js) importa o módulo e chama a função",
      "direto — é teste de módulo, nunca um E2E. A capacidade é real e está",
      "testada; o que não está provado é o comportamento ponta a ponta que o",
      "contrato reivindicava. Fabricar um comando aqui só para restaurar o verde",
      "seria a mentira que o gate existe para impedir.",
    ].join(" "),
  }),

  /**
   * As duas declarações CORRIGIDAS em vez de derrubadas — e por quê.
   *
   * Em ambas o campo de caminho carregava um parêntese em prosa
   * (`package.json (script sbom)`). A evidência substantiva — o teste que roda
   * `npm sbom` e o que roda o `c8` real, provados em S51.6.6/S51.6.8 — não mudou
   * uma linha; o que mudou é que o campo passou a dizer só o que é verificável.
   * Isto NÃO é grandfathering: as duas continuam tendo de passar nas sete regras
   * por conta própria, e passam.
   */
  ajustes: Object.freeze({
    "governance": "evidenceAdapter deixou de ser `package.json (script sbom)` e passou a ser `package.json`; o script continua nomeado no e2eCommand, que é executável e verificado.",
    "type-coverage": "evidenceAdapter deixou de ser `package.json (script coverage:ci)` e passou a ser `package.json`; o e2eCommand virou `npm run coverage:ci`, sem o parêntese com os thresholds (que o próprio teste já verifica).",
  }),
})

/** A transição medida AGORA, a partir dos contratos vivos. */
export function transicaoMedida(contratos = CLAIM_CONTRACTS, io = undefined) {
  const entradas = Object.entries(contratos)
  const comContrato = entradas.filter(([, c]) => hasBehavioralContract(c))
  const comDentes = comContrato.filter(([, c]) => contratoComDentes(c, io))
  const semDentes = comContrato.filter(([, c]) => !contratoComDentes(c, io))
  return {
    antes: { comContrato: comContrato.length, semContrato: entradas.length - comContrato.length },
    depois: { comDentes: comDentes.length, semDentes: semDentes.length },
    quedas: Object.fromEntries(semDentes.map(([id, c]) => [id, problemasDoContrato(c, io)])),
  }
}

const contagemDivergente = (medido, gravado, campos) => campos
  .filter((f) => medido[f] !== gravado[f])
  .map((f) => `${f}: medido ${medido[f]}, baseline ${gravado[f]}`)

/**
 * O que diverge entre a medição de agora e o baseline gravado. Lista vazia = o
 * placar continua sendo o que foi registrado, pelos mesmos motivos.
 */
export function divergenciaDoBaseline(contratos = CLAIM_CONTRACTS, io = undefined) {
  const m = transicaoMedida(contratos, io)
  const problemas = [
    ...contagemDivergente(m.antes, TEETH_BASELINE.antes, ["comContrato", "semContrato"]),
    ...contagemDivergente(m.depois, TEETH_BASELINE.depois, ["comDentes", "semDentes"]),
  ]
  const gravadas = new Set(Object.keys(TEETH_BASELINE.quedas))
  for (const id of Object.keys(m.quedas)) {
    if (!gravadas.has(id)) problemas.push(`queda NÃO registrada no baseline: ${id} — ${m.quedas[id].join("; ")}`)
  }
  for (const id of gravadas) {
    if (!(id in m.quedas)) problemas.push(`baseline registra queda que não acontece mais: ${id} (remova o registro ou explique)`)
  }
  return problemas
}
