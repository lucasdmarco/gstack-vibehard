/**
 * Schemas do PRD52 — Sprint 52.A. FUNDAÇÃO, sem consumidor.
 *
 * São validadores PUROS: descrevem a forma que o §25 e o §26 exigem e recusam
 * o que não a tem. Nenhum deles lê disco, executa comando ou decide política —
 * quem consome vem nos sprints 52.B–52.G, e criar consumidor aqui acoplaria a
 * fundação ao primeiro uso dela.
 *
 * FAIL-CLOSED em todos: campo ausente NÃO é inferido, valor fora do vocabulário
 * NÃO é aceito com aviso, e nenhum default preenche o que a evidência deveria
 * preencher. É o mesmo princípio que governa o inventário e os checklists — o
 * estado desconhecido tem nome próprio e bloqueia, em vez de virar o valor mais
 * conveniente.
 *
 * Cada validador é uma TABELA DE REGRAS (ver `schema-rules.js`), e não uma
 * cadeia de condicionais: a lista de invariantes fica legível como lista, e
 * acrescentar uma regra não aumenta a complexidade de nenhuma função.
 */

import { ehClaimIdCanonico } from "./claim-id.js"
import { problemas, camposObrigatorios, doVocabulario, naoEhObjeto } from "./schema-rules.js"

// ═══════════════════════════════════════════════════════════════════════════
//  §26.1 — Reconciliação executável de claims
// ═══════════════════════════════════════════════════════════════════════════

export const CLAIM_RECONCILIATION_SCHEMA = "gstack.claim-reconciliation.v1"

export const CLAIM_RECONCILIATION_FIELDS = Object.freeze([
  "claimId", "sourceCommit", "requiredEvidenceRefs", "observedEvidenceRefs",
  "ledgerStatus", "proofStatus", "blockerStatus", "rcStatus",
  "consistencyVerdict", "checkedAt",
])

/**
 * Vereditos possíveis. `inconclusive:claim_conflict` é um estado de primeira
 * classe, e não um `fail` disfarçado: fontes que se contradizem SEM adjudicação
 * são um problema diferente de evidência que contradiz a claim.
 */
export const CONSISTENCY_VERDICTS = Object.freeze([
  "consistent", "fail", "not_proved", "inconclusive:claim_conflict",
])

const ehLista = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0)
const ehIso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v)
const ehSha = (v) => typeof v === "string" && /^[0-9a-f]{7,40}$/.test(v)

/** A evidência exigida que NÃO foi observada. */
function faltantes(r) {
  const req = Array.isArray(r.requiredEvidenceRefs) ? r.requiredEvidenceRefs : []
  const obs = new Set(Array.isArray(r.observedEvidenceRefs) ? r.observedEvidenceRefs : [])
  return req.filter((x) => !obs.has(x))
}

/**
 * Coerência só se avalia sobre listas bem formadas. Com `requiredEvidenceRefs`
 * malformado o problema já foi acusado pela regra de forma, e insistir aqui
 * produziria duas queixas sobre o mesmo defeito.
 */
const coerenciaAplicavel = (r) => r.requiredEvidenceRefs === undefined || ehLista(r.requiredEvidenceRefs)
const exigeEvidencia = (r) => Array.isArray(r.requiredEvidenceRefs) && r.requiredEvidenceRefs.length > 0

const REGRAS_DA_RECONCILIACAO = Object.freeze([
  ...camposObrigatorios(CLAIM_RECONCILIATION_FIELDS),
  {
    when: (r) => r.claimId !== undefined && !ehClaimIdCanonico(r.claimId),
    problem: (r) => `claimId fora da forma canônica: ${JSON.stringify(r.claimId)}`,
  },
  {
    when: (r) => r.sourceCommit !== undefined && !ehSha(r.sourceCommit),
    problem: () => "sourceCommit precisa ser um SHA — reconciliar sem commit não diz de QUANDO é a evidência",
  },
  ...["requiredEvidenceRefs", "observedEvidenceRefs"].map((f) => ({
    when: (r) => r[f] !== undefined && !Array.isArray(r[f]),
    problem: () => `${f} precisa ser lista`,
  })),
  doVocabulario("consistencyVerdict", CONSISTENCY_VERDICTS),
  {
    when: (r) => r.checkedAt !== undefined && !ehIso(r.checkedAt),
    problem: () => "checkedAt precisa ser data ISO",
  },

  // As regras do §26.1 que NÃO são forma, e sim conteúdo. Evidência ausente
  // mantém `not_proved`; declarar `consistent` sem ter observado o que era
  // exigido é exatamente a mentira que a reconciliação existe para impedir.
  {
    when: (r) => coerenciaAplicavel(r) && r.consistencyVerdict === "consistent" && faltantes(r).length > 0,
    problem: (r) => "`consistent` com evidência ausente: " + faltantes(r).join(", "),
  },
  {
    when: (r) => coerenciaAplicavel(r) && r.consistencyVerdict === "not_proved"
      && exigeEvidencia(r) && faltantes(r).length === 0,
    problem: () => "`not_proved` com TODA a evidência exigida observada — o veredito contradiz o dado",
  },
])

/**
 * Problemas de UMA reconciliação. Lista vazia = válida.
 *
 * Devolve TODOS os problemas, não o primeiro: quem escreve o registro precisa
 * saber tudo o que falta de uma vez, e parar no primeiro erro transformaria a
 * correção numa sequência de tentativas.
 */
export function problemasDaReconciliacao(r) {
  if (naoEhObjeto(r)) return ["reconciliação não é objeto"]
  return problemas(r, REGRAS_DA_RECONCILIACAO)
}

export const reconciliacaoValida = (r) => problemasDaReconciliacao(r).length === 0

// ═══════════════════════════════════════════════════════════════════════════
//  §26.2 — Readiness tem validade temporal
// ═══════════════════════════════════════════════════════════════════════════

export const READINESS_OBSERVATION_SCHEMA = "gstack.readiness-observation.v1"

export const READINESS_OBSERVATION_FIELDS = Object.freeze([
  "capabilityId", "status", "generatedAt", "staleAfterSeconds",
  "sourceCommit", "observedHead", "probeCommandRef", "probeResultRef",
])

/** `stale` e `unknown` são estados CONSUMÍVEIS — não erros a esconder. */
export const READINESS_STATUSES = Object.freeze([
  "callable", "routed", "missing", "stale", "unknown",
])

/** Estados que já são o próprio veredito: nada os degrada mais. */
const ESTADOS_TERMINAIS = Object.freeze(["stale", "unknown", "missing"])

const headMudou = (o) => Boolean(o.sourceCommit && o.observedHead && o.sourceCommit !== o.observedHead)
const janelaDe = (o) => (Number(o.staleAfterSeconds) > 0 ? Number(o.staleAfterSeconds) : null)
const nascimentoDe = (o) => (Number.isFinite(Date.parse(o.generatedAt ?? "")) ? Date.parse(o.generatedAt) : null)
const semRelogio = (o) => nascimentoDe(o) === null || janelaDe(o) === null
const expirou = (o, agoraMs) => (agoraMs - nascimentoDe(o)) / 1000 > janelaDe(o)

/**
 * As DEGRADAÇÕES do §26.2, em ordem. A primeira que casa decide.
 *
 * Nenhuma delas é opinião: o estado sai do vocabulário, a prova do comando
 * sumiu, o HEAD relevante mudou, ou o prazo expirou. Arquivo antigo no workspace
 * NÃO representa o estado atual por existir — é a frase do §26.2, e é o defeito
 * que esta tabela torna impossível.
 */
const DEGRADACOES = Object.freeze([
  { when: (o) => !READINESS_STATUSES.includes(o.status), estado: () => "unknown" },
  { when: (o) => ESTADOS_TERMINAIS.includes(o.status), estado: (o) => o.status },
  { when: (o) => !o.probeResultRef, estado: () => "unknown" },
  { when: (o) => headMudou(o), estado: () => "stale" },
  { when: (o) => semRelogio(o), estado: () => "unknown" },
  { when: (o, agoraMs) => expirou(o, agoraMs), estado: () => "stale" },
])

/** O que o consumidor PODE usar, dado o tempo e o HEAD. */
export function estadoConsumivel(obs, agoraMs) {
  if (naoEhObjeto(obs)) return "unknown"
  const degradacao = DEGRADACOES.find((d) => d.when(obs, agoraMs))
  return degradacao ? degradacao.estado(obs) : obs.status
}

const REGRAS_DA_OBSERVACAO = Object.freeze([
  ...camposObrigatorios(READINESS_OBSERVATION_FIELDS),
  doVocabulario("status", READINESS_STATUSES),
  {
    when: (o) => o.staleAfterSeconds !== undefined && !(Number(o.staleAfterSeconds) > 0),
    problem: () => "staleAfterSeconds precisa ser positivo — sem janela não há validade",
  },
])

export function problemasDaObservacao(o) {
  if (naoEhObjeto(o)) return ["observação não é objeto"]
  return problemas(o, REGRAS_DA_OBSERVACAO)
}

// ═══════════════════════════════════════════════════════════════════════════
//  §26.3 — Evidência de suporte é uma matriz OS × Node
// ═══════════════════════════════════════════════════════════════════════════

export const SUPPORT_CELL_SCHEMA = "gstack.support-cell.v1"

export const SUPPORT_CELL_FIELDS = Object.freeze([
  "os", "arch", "nodeVersion", "packageHash",
  "installReceiptRef", "runtimeReceiptRef", "uninstallReceiptRef", "verdict",
])

/** `not_run` é o DEFAULT e não uma falha: célula sem execução não é vermelha nem verde. */
export const SUPPORT_VERDICTS = Object.freeze(["pass", "fail", "not_run"])

/** Os recibos SEM os quais um verde não é verde. */
const RECIBOS_DE_PASS = Object.freeze([
  "packageHash", "installReceiptRef", "runtimeReceiptRef", "uninstallReceiptRef",
])

/** Célula nova nasce `not_run`, com os recibos vazios. */
export function celulaNaoExecutada({ os, arch, nodeVersion }) {
  return {
    os, arch, nodeVersion,
    packageHash: null,
    installReceiptRef: null, runtimeReceiptRef: null, uninstallReceiptRef: null,
    verdict: "not_run",
  }
}

const REGRAS_DA_CELULA = Object.freeze([
  ...camposObrigatorios(SUPPORT_CELL_FIELDS),
  doVocabulario("verdict", SUPPORT_VERDICTS),
  // `pass` EXIGE os quatro recibos: uma célula verde sem hash do pacote e sem
  // recibo de instalação, runtime e uninstall afirma quatro coisas e prova
  // nenhuma.
  ...RECIBOS_DE_PASS.map((r) => ({
    when: (c) => c.verdict === "pass" && !c[r],
    problem: () => "`pass` sem " + r + " — verde precisa de recibo",
  })),
])

export function problemasDaCelula(c) {
  if (naoEhObjeto(c)) return ["célula não é objeto"]
  return problemas(c, REGRAS_DA_CELULA)
}

/**
 * A matriz PÚBLICA: só células provadas.
 *
 * Decisão humana pode REDUZIR a faixa declarada, e é legítimo. O que ela não faz
 * é transformar célula falha ou não executada em verde — a frase do §26.3.
 */
export function matrizPublica(celulas, { faixaReduzida = null } = {}) {
  const provadas = (celulas || []).filter((c) => c.verdict === "pass")
  if (!faixaReduzida) return provadas
  return provadas.filter((c) => faixaReduzida.includes(c.nodeVersion))
}
