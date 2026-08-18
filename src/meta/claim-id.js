/**
 * `claimId` CANÔNICO — o identificador que todas as projeções compartilham.
 *
 * O §26.1 do PRD52 diz que DoD, blockers, Evidence Ledger, `proof`, closeout e
 * matriz de RC são PROJEÇÕES DA MESMA CLAIM. Hoje cada uma usa o identificador
 * que quis: o Dream Audit usa `auto-dream`, o checklist usa `P0.CODEX-HOOKS`, o
 * DoD usa `DOD.7`. Nenhum deles é errado — mas sem uma forma canônica não há
 * como perguntar "esta claim está consistente entre as projeções", que é a
 * pergunta inteira do §26.1.
 *
 * ESTE MÓDULO NÃO RENOMEIA NADA. Ele dá um identificador ESTÁVEL e derivável a
 * partir do par (fonte, id local), e nada mais. Renomear os ids existentes
 * quebraria recibos ancorados que já citam os nomes de hoje.
 */

export const CLAIM_ID_SCHEMA = "gstack.claim-id.v1"

/**
 * As projeções reconhecidas. Vocabulário FECHADO: uma fonte fora desta lista é
 * erro de dado, e não uma projeção nova que o reconciliador deveria adivinhar.
 */
export const CLAIM_SOURCES = Object.freeze([
  "dream_audit",   // src/dream/auditor.js — claims de capacidade
  "rc_checklist",  // src/dream/rc-checklist-prd*.js — itens de sprint e achados
  "dod",           // PRD51_DOD_ITEMS — as caixas do §9
  "evidence_ledger",
  "proof",
  "rc_matrix",
  "closeout",
])

const SEPARADOR = ":"

/** `fonte` é conhecida? Nada aqui adivinha. */
export const ehFonteConhecida = (fonte) => CLAIM_SOURCES.includes(fonte)

/**
 * Forma canônica: `<fonte>:<idLocal>`.
 *
 * O id local é preservado VERBATIM, incluindo maiúsculas e pontos. Normalizar
 * (minúsculas, troca de separador) faria dois ids diferentes colidirem, e uma
 * colisão silenciosa entre claims é pior do que um id feio.
 */
export function claimId(fonte, idLocal) {
  if (!ehFonteConhecida(fonte)) {
    throw new Error(`claim-id: fonte desconhecida ${JSON.stringify(fonte)} — vocabulário é fechado`)
  }
  const local = String(idLocal ?? "").trim()
  if (local.length === 0) throw new Error("claim-id: id local vazio")
  if (local.includes(SEPARADOR)) {
    // Um id local com `:` tornaria o parse ambíguo, e o parse é o que permite
    // voltar da forma canônica para a projeção de origem.
    throw new Error(`claim-id: id local não pode conter ${SEPARADOR}: ${JSON.stringify(local)}`)
  }
  return `${fonte}${SEPARADOR}${local}`
}

/** Volta ao par de origem, ou `null` quando a string não é um id canônico. */
export function parseClaimId(id) {
  const s = String(id ?? "")
  const i = s.indexOf(SEPARADOR)
  if (i <= 0 || i === s.length - 1) return null
  const fonte = s.slice(0, i)
  const local = s.slice(i + 1)
  if (!ehFonteConhecida(fonte) || local.includes(SEPARADOR)) return null
  return { source: fonte, localId: local }
}

export const ehClaimIdCanonico = (id) => parseClaimId(id) !== null
