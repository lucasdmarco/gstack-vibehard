import { createHash } from "node:crypto"
import { redactSecrets } from "../security/redact.js"
import { externalContentTrust, citationSupportsClaim } from "./invariants.js"

/**
 * Source ledger e citation support (PRD50 S50.2, §12.2).
 *
 * O ponto do módulo: **existir não é sustentar**. Uma URL válida, alcançável e
 * corretamente citada ainda pode não conter a frase que lhe foi atribuída — é
 * o modo de falha que o §2.2 do PRD chama de misquotation e que busca/grounding
 * NÃO resolvem sozinhos.
 *
 * PURO: nenhuma função aqui faz rede. Quem busca é a camada de cima; aqui só se
 * registra, sanitiza e classifica o que já foi obtido.
 */
export const EPISTEMIC_SOURCE_SCHEMA = "gstack.epistemic-source.v1"
export const SOURCE_KINDS = Object.freeze(["primary", "secondary", "unknown"])
export const MAX_SNAPSHOT_CHARS = 2000

const sha256 = (s) => "sha256:" + createHash("sha256").update(String(s)).digest("hex")

const normalize = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim()

// Negação simples: o trecho fala do mesmo assunto mas nega o claim.
const NEGATIONS = Object.freeze(["não ", "nao ", " not ", "never ", "nunca "])

const stripNegations = (t) => NEGATIONS.reduce((acc, n) => acc.split(n).join(" "), ` ${t} `)

/** Palavras "de conteúdo" do claim (≥4 chars) — base da checagem de suporte. */
function contentTerms(claim) {
  return normalize(claim).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4)
}

function overlapRatio(claim, text) {
  const terms = contentTerms(claim)
  if (!terms.length) return 0
  const hay = normalize(text)
  return terms.filter((t) => hay.includes(t)).length / terms.length
}

const hasNegationAgainst = (claim, excerpt) => {
  const negated = overlapRatio(claim, stripNegations(normalize(excerpt)))
  const raw = overlapRatio(claim, excerpt)
  return NEGATIONS.some((n) => normalize(excerpt).includes(n.trim())) && raw >= 0.5 && negated >= 0.5
}

/**
 * Estado de suporte de uma citação (§12.2). Ordem importa: primeiro checa se o
 * trecho SEQUER existe na fonte (misquotation), depois contradição, depois
 * suporte, e o resto é mera menção.
 *
 * → { state: supports|contradicts|mentions_only|not_found, reason, overlap }
 */
export function evaluateCitationSupport({ claim = "", excerpt = "", content = "" } = {}) {
  const inSource = normalize(content).includes(normalize(excerpt))
  if (!inSource) {
    return { state: "not_found", reason: "trecho não foi encontrado no conteúdo da fonte (possível misquotation)", overlap: 0 }
  }
  const overlap = overlapRatio(claim, excerpt)
  if (hasNegationAgainst(claim, excerpt)) {
    return { state: "contradicts", reason: "o trecho nega o claim", overlap }
  }
  if (overlap >= 0.75) return { state: "supports", reason: "o trecho sustenta o claim", overlap }
  return { state: "mentions_only", reason: "o trecho apenas menciona o tema, sem sustentar o claim", overlap }
}

const kindOf = (k) => (SOURCE_KINDS.includes(k) ? k : "unknown")

function temporalWarningFor(publishedAt, consultedAt) {
  if (!publishedAt || !consultedAt) return null
  return consultedAt < publishedAt ? "consulted_before_published" : null
}

function safeExcerpt(content) {
  const { redacted, count } = redactSecrets(String(content || ""))
  const truncated = redacted.length > MAX_SNAPSHOT_CHARS
  return {
    excerptSafe: truncated ? redacted.slice(0, MAX_SNAPSHOT_CHARS) + "…[truncado]" : redacted,
    redactedCount: count,
    truncated,
  }
}

/**
 * Snapshot de uma fonte já obtida. Sanitiza (nunca persiste secret), limita o
 * tamanho, hasheia o conteúdo ORIGINAL (para provar identidade) e marca
 * untrusted quando há injection.
 */
export function buildSourceSnapshot({
  url = "", finalUrl = null, title = "", publishedAt = null, consultedAt = null,
  content = "", kind = null,
} = {}) {
  const { excerptSafe, redactedCount, truncated } = safeExcerpt(content)
  const trust = externalContentTrust(content)
  return {
    schemaVersion: EPISTEMIC_SOURCE_SCHEMA,
    url, canonicalUrl: finalUrl || url, redirected: Boolean(finalUrl && finalUrl !== url),
    title, publishedAt, consultedAt,
    kind: kindOf(kind),
    contentHash: sha256(content),
    excerptSafe, redactedCount, truncated,
    trusted: trust.trusted, injectionFindings: trust.findings,
    temporalWarning: temporalWarningFor(publishedAt, consultedAt),
  }
}

/**
 * Desfecho de uma fonte no ledger. Fonte inalcançável falha o CLAIM
 * (fail-closed), nunca a CLI inteira (§10.1).
 */
export function recordSourceOutcome({ reachable = false, support = "not_found" } = {}) {
  if (!reachable) {
    return { outcome: "source_unreachable", mayRaiseConfidence: false, failsClaimOnly: true }
  }
  const supported = citationSupportsClaim(support)
  return {
    outcome: supported ? "claim_supported" : "source_discovered",
    mayRaiseConfidence: supported,
    failsClaimOnly: false,
  }
}

/** Ledger agregado. `notPerformed` é obrigatório: o que não se consultou fica dito. */
export function buildSourceLedger({ snapshots = [], notPerformed = [] } = {}) {
  return {
    schemaVersion: EPISTEMIC_SOURCE_SCHEMA,
    sources: snapshots,
    notPerformed,
    counts: {
      total: snapshots.length,
      untrusted: snapshots.filter((s) => s.trusted === false).length,
      redirected: snapshots.filter((s) => s.redirected === true).length,
    },
  }
}
