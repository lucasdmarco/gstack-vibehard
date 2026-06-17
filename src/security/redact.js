import { createHash } from "crypto"

/**
 * Redaction reutilizável (PRD Fase 3 §3/§8) — paridade JS do hooks/_redact.py.
 * Mascara segredos/PII antes de qualquer publicação/exibição. NUNCA retorna o
 * segredo bruto — só o texto redigido + fingerprints (hash).
 *
 * Nota honesta: isto é uma LIB de redaction pré-publicação, NÃO um interceptor do
 * stream de render do harness (uma CLI não controla esse render — ver capabilities).
 */

export const REDACTION_MARK = "***REDACTED***"

// Mesmos padrões do _output_guard.py (mantidos em sincronia).
const SENSITIVE_PATTERNS = [
  /(sk_live_|sk_test_|pk_live_|pk_test_|whsec_|acct_)[A-Za-z0-9]{20,}/gi,
  /(api[-_]?key|apikey|secret|password|token|auth_token|private_key)\s*[=:]\s*["'][^"']{8,}/gi,
  /(ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{36,}/gi,
  /(xox[parbse]-)[A-Za-z0-9-]{20,}/gi,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
]

function fingerprint(secret) {
  return "sha256:" + createHash("sha256").update(String(secret)).digest("hex").slice(0, 12)
}

/**
 * @returns {{ redacted: string, count: number, fingerprints: string[] }}
 */
export function redactSecrets(text) {
  if (!text) return { redacted: text || "", count: 0, fingerprints: [] }
  let redacted = String(text)
  const fingerprints = []
  for (const re of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(re, (m) => { fingerprints.push(fingerprint(m)); return REDACTION_MARK })
  }
  return { redacted, count: fingerprints.length, fingerprints }
}

/** True se o texto contém algum segredo/PII detectável. */
export function hasSecret(text) {
  return redactSecrets(text).count > 0
}
