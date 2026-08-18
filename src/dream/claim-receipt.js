/**
 * RECIBO de claim (PRD52 S52.C) — a evidência que foi observada, e quando.
 *
 * O S52.B provou que o contrato APONTA para evidência real. O que ele não podia
 * dizer é *quando* essa evidência foi olhada, nem se ela continua sendo a mesma
 * coisa que estava lá quando alguém disse REAL. Sem isso, um contrato válido em
 * julho segue parecendo válido em dezembro embora todo arquivo que ele cita
 * tenha mudado — o placar afirma o passado no presente.
 *
 * O recibo fecha isso ancorando por HASH: cada arquivo de evidência entra com o
 * seu sha256 e o commit em que foi lido. Reler é barato, e a divergência é
 * detectada em vez de deduzida.
 *
 * O QUE UM RECIBO NÃO É: prova de que o comportamento funciona. Ele prova
 * IDENTIDADE da evidência ao longo do tempo — que o que está sendo citado hoje é
 * o que foi observado. Confundir as duas coisas seria trocar uma mentira por
 * outra mais difícil de ver.
 */

import { createHash } from "node:crypto"
import { claimId as canonico } from "../meta/claim-id.js"
import { leitorPadrao } from "./claim-contract-check.js"
import { CLAIM_CONTRACT_FIELDS } from "./claim-contract.js"

export const CLAIM_RECEIPT_SCHEMA = "gstack.claim-receipt.v1"

export const CLAIM_RECEIPT_FIELDS = Object.freeze([
  "claimId", "sourceCommit", "contractHash", "observedEvidenceRefs", "generatedAt",
])

const sha256 = (texto) => createHash("sha256").update(String(texto), "utf-8").digest("hex")

const CAMINHO_NO_REPO = /(?:^|[\s"'`(])((?:src|scripts|hooks|tests|agents)\/[A-Za-z0-9_.\/-]+\.(?:js|mjs|py|json))/g
const caminhosCitados = (texto) => [
  ...new Set([...String(texto || "").matchAll(CAMINHO_NO_REPO)].map((m) => m[1])),
]

/**
 * Os arquivos que CONSTITUEM a evidência do contrato: o adaptador, o entrypoint
 * do comando E2E e os testes do controle negativo.
 *
 * A lista sai dos campos do próprio contrato — não de uma tabela paralela. Uma
 * segunda lista envelheceria em silêncio quando o contrato mudasse, que é
 * exatamente o defeito que este módulo existe para tornar visível.
 */
export function evidenciasDoContrato(contract) {
  if (!contract || typeof contract !== "object") return []
  const campos = [contract.evidenceAdapter, contract.e2eCommand, contract.negativeControl]
  return [...new Set(campos.flatMap((v) => caminhosCitados(v)))].sort()
}

/** O hash do CONTRATO em si: trocar a declaração invalida o recibo, mesmo com arquivos intactos. */
export const hashDoContrato = (contract) => sha256(
  CLAIM_CONTRACT_FIELDS.map((f) => `${f}=${contract?.[f] ?? ""}`).join("\n"),
)

/**
 * Emite o recibo de UMA claim.
 *
 * Arquivo ausente entra com `sha256: null` e `state: "missing"` — nunca é
 * omitido da lista. Sumir da lista faria a evidência ausente parecer evidência
 * que ninguém pediu.
 */
export function emitirRecibo({ claimId, contract, io = leitorPadrao(), sourceCommit = null, agora = null }) {
  const refs = evidenciasDoContrato(contract).map((p) => (
    io.has(p)
      ? { path: p, sha256: sha256(io.read(p)), state: "observed" }
      : { path: p, sha256: null, state: "missing" }
  ))
  return {
    schemaVersion: CLAIM_RECEIPT_SCHEMA,
    claimId: canonico("dream_audit", claimId),
    sourceCommit,
    contractHash: hashDoContrato(contract),
    observedEvidenceRefs: refs,
    generatedAt: agora || new Date().toISOString(),
  }
}

const REGRAS_DO_RECIBO = Object.freeze([
  ...CLAIM_RECEIPT_FIELDS.map((f) => ({
    when: (r) => !(f in r),
    problem: () => `campo ausente: ${f}`,
  })),
  {
    // Um recibo sem commit não diz DE QUANDO é a observação, e é a única coisa
    // que ele tem a mais que o contrato.
    when: (r) => !r.sourceCommit,
    problem: () => "sourceCommit ausente — recibo sem commit não ancora nada no tempo",
  },
  {
    when: (r) => !Array.isArray(r.observedEvidenceRefs) || r.observedEvidenceRefs.length === 0,
    problem: () => "observedEvidenceRefs vazio — um recibo que não observou nada não prova nada",
  },
])

export function problemasDoRecibo(recibo) {
  if (!recibo || typeof recibo !== "object") return ["recibo não é objeto"]
  return REGRAS_DO_RECIBO.filter((r) => r.when(recibo)).map((r) => r.problem(recibo))
}

/**
 * O que MUDOU desde que o recibo foi emitido.
 *
 * Três divergências, e as três importam por motivos diferentes: o arquivo mudou
 * de conteúdo (`changed`), sumiu (`missing`), ou voltou a existir depois de ter
 * sido observado ausente (`restored`). Nenhuma é tratada como equivalente às
 * outras, porque a ação humana correta é diferente em cada caso.
 */
export function driftDoRecibo(recibo, io = leitorPadrao()) {
  const refs = Array.isArray(recibo?.observedEvidenceRefs) ? recibo.observedEvidenceRefs : []
  return refs.flatMap((ref) => {
    const existe = io.has(ref.path)
    if (!existe && ref.sha256) return [{ path: ref.path, state: "missing", expected: ref.sha256, actual: null }]
    if (!existe) return []
    const atual = sha256(io.read(ref.path))
    if (!ref.sha256) return [{ path: ref.path, state: "restored", expected: null, actual: atual }]
    return atual === ref.sha256 ? [] : [{ path: ref.path, state: "changed", expected: ref.sha256, actual: atual }]
  })
}

/**
 * O recibo ainda descreve o repo de agora?
 *
 * Exige as três coisas: o recibo é bem formado, o contrato não foi trocado por
 * baixo dele, e nenhum arquivo divergiu. Falhar qualquer uma devolve o MOTIVO —
 * um `false` sozinho obrigaria quem lê a redescobrir o que já foi medido.
 */
export function reciboConfere(recibo, contract, io = leitorPadrao()) {
  const problemas = problemasDoRecibo(recibo)
  if (problemas.length) return { ok: false, reason: "recibo_invalido", detail: problemas }
  if (recibo.contractHash !== hashDoContrato(contract)) {
    return { ok: false, reason: "contrato_mudou", detail: ["a declaração mudou desde a observação — reemita o recibo"] }
  }
  const drift = driftDoRecibo(recibo, io)
  if (drift.length) return { ok: false, reason: "evidencia_mudou", detail: drift }
  return { ok: true, reason: null, detail: [] }
}
