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
  depois: Object.freeze({ regra: "verificação executável (PRD52 S52.B)", comDentes: 24, semDentes: 0 }),

  /**
   * As claims que a régua nova derruba HOJE, com o motivo.
   *
   * Está vazio, e o caminho até aqui é o ponto: a única queda foi FECHADA por
   * trabalho (ver `resolvidas`), nunca por afrouxar a regra. Um `quedas` vazio
   * obtido relaxando o gate seria indistinguível deste no formato — e é por isso
   * que o histórico fica gravado ao lado, em vez de sumir quando a conta zera.
   */
  quedas: Object.freeze({}),

  /**
   * As quedas que foram FECHADAS, e como. O registro não some quando a conta
   * zera: sem ele, o próximo leitor não teria como distinguir "a régua nunca
   * derrubou nada" de "derrubou e alguém consertou".
   */
  resolvidas: Object.freeze({
    "action-kernel": {
      sprint: "S52.I",
      caiuPor: [
        "e2e_executavel: o campo declarava `runGovernedAction (task/workflow/delegate)`,",
        "que é um NOME DE FUNÇÃO, não um comando. O controle negativo",
        "(tests/action_kernel_governed.test.js) importava o módulo e chamava a",
        "função direto — teste de módulo, nunca um E2E.",
      ].join(" "),
      fechadaPor: [
        "A investigação achou algo pior que o campo mal escrito: `runGovernedAction`",
        "não tinha UM chamador em código de produto, embora o kernel se descrevesse",
        "como 'o ponto por onde CLI/hooks/adapters passam'. O `delegate` mandava a",
        "tarefa direto ao alvo, reimplementando o gate. O S52.I ligou o `delegate`",
        "ao kernel e escreveu o E2E pelo binário real: tarefa destrutiva é negada e",
        "o alvo NÃO é invocado; tarefa equivalente sem o gatilho atravessa e chega",
        "ao alvo. A claim voltou a REAL por capacidade nova, não por régua mais",
        "frouxa — o gate segue exatamente como estava.",
      ].join(" "),
    },
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
