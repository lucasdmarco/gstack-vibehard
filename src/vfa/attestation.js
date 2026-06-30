import { createHash, randomBytes } from "crypto"

/**
 * VFA — Action Attestation (PRD 13 §10.2 / PR13.4). Recibos assinados por HASH-CHAIN
 * para ações críticas: prova o que o agente TENTOU, o que recebeu/alterou (por hash,
 * sem o conteúdo bruto), qual policy avaliou e por quê. Append-only + cadeia (cada
 * recibo encadeia o anterior por `previousHash`), então adulteração/reordenação quebra
 * a verificação. PURO/testável — sem IO (a persistência fica em provenance.js).
 */

export const GENESIS = "sha256:" + "0".repeat(64)

export function sha256(s) {
  return "sha256:" + createHash("sha256").update(String(s == null ? "" : s)).digest("hex")
}

/** Serialização ESTÁVEL (chaves ordenadas recursivamente) → hash reprodutível. */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]"
  const keys = Object.keys(value).sort()
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}"
}

function hashOf(v) {
  return sha256(v == null ? "" : (typeof v === "string" ? v : stableStringify(v)))
}

/**
 * Constrói um recibo encadeado. `input`/`output` são HASHEADOS (nunca guardados crus).
 * `receiptHash` cobre todos os campos (inclusive `previousHash`) — a cadeia é selada.
 */
export function buildReceipt(opts = {}) {
  const r = {
    schemaVersion: 1,
    actionId: opts.actionId || "act_" + randomBytes(8).toString("hex"),
    runId: String(opts.runId || "run_unknown"),
    parentActionId: opts.parentActionId || null,
    actor: opts.actor || {},
    intent: opts.intent || "unknown",
    target: opts.target || {},
    inputHash: hashOf(opts.input),
    outputHash: hashOf(opts.output),
    policy: opts.policy || { decision: "allow", rules: [] },
    timestamp: opts.timestamp || new Date(opts.now || Date.now()).toISOString(),
    previousHash: opts.previousHash || GENESIS,
  }
  r.receiptHash = sha256(stableStringify(r)) // r ainda sem receiptHash → sela o conteúdo
  return r
}

/** Recalcula o hash de um recibo (excluindo o próprio receiptHash/signature). */
export function recomputeHash(receipt) {
  const { receiptHash, signature, ...rest } = receipt
  return sha256(stableStringify(rest))
}

/**
 * Verifica a CADEIA de recibos (em ordem). Pega: receiptHash adulterado (qualquer
 * campo mudou) e previousHash quebrado (recibo removido/reordenado/inserido).
 * → { valid, brokenAt?, reason?, length }.
 */
export function verifyChain(receipts = []) {
  let prev = GENESIS
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]
    if (!r || typeof r !== "object") return { valid: false, brokenAt: i, reason: "recibo inválido" }
    if (recomputeHash(r) !== r.receiptHash) return { valid: false, brokenAt: i, reason: "receiptHash não confere (recibo adulterado)" }
    if (r.previousHash !== prev) return { valid: false, brokenAt: i, reason: "previousHash quebrado (cadeia rompida — recibo removido/reordenado?)" }
    prev = r.receiptHash
  }
  return { valid: true, length: receipts.length }
}

/** Defesa: redige valores de segredo de campos textuais do recibo antes de persistir. */
export function redactReceiptValues(receipt, secretValues = []) {
  const red = (s) => { let v = String(s); for (const sec of secretValues) if (sec && String(sec).length >= 4) v = v.split(String(sec)).join("***"); return v }
  const out = { ...receipt }
  if (out.target && out.target.pathOrName) out.target = { ...out.target, pathOrName: red(out.target.pathOrName) }
  if (typeof out.intent === "string") out.intent = red(out.intent)
  return out
}
