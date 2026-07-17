/**
 * PRD45 S45.3 (P1.5) — redação RECURSIVA de eventos antes de qualquer escrita no journal.
 *
 * O journal so apagava as chaves EXATAS secret/transcript no top-level; um token em
 * task/summary/signature, aninhado em objeto/array, ou embutido numa URL persistia no
 * journal.jsonl do run. Aqui, uma unica passada varre o evento inteiro:
 *   - chaves sensiveis por NOME (token/password/apiKey/...) sao mascaradas;
 *   - toda string passa pelo redactSecrets compartilhado (padroes sk_/ghp_/URL com token);
 *   - limites de PROFUNDIDADE e TAMANHO (journal bounded — nao explode com objeto gigante).
 * Reusa src/security/redact.js (redactor unico do projeto) — nao reimplementa padroes.
 */
import { redactSecrets, REDACTION_MARK } from "../security/redact.js"

// Removidas por completo (metadado inútil no replay e potencialmente enorme/sensível).
const DROP_KEYS = new Set(["secret", "transcript"])
// Nome de chave que denuncia segredo, independente do valor casar um padrão.
const SENSITIVE_KEY_RX = /(secret|token|password|passwd|api[-_]?key|apikey|auth|credential|private[-_]?key|bearer)/i
const MAX_DEPTH = 8
const MAX_STRING = 4096

const truncate = (s) => (s.length > MAX_STRING ? s.slice(0, MAX_STRING) + "…[truncated]" : s)
const redactString = (s) => truncate(redactSecrets(String(s)).redacted)

function redactValue(value, depth) {
  if (depth > MAX_DEPTH) return "[max_depth]"
  if (typeof value === "string") return redactString(value)
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactValue(v, depth + 1))
  if (value && typeof value === "object") return redactObject(value, depth)
  return value // number/bool/null — inofensivo
}
function redactObject(obj, depth) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (DROP_KEYS.has(k)) continue
    if (SENSITIVE_KEY_RX.test(k)) { out[k] = REDACTION_MARK; continue }
    out[k] = redactValue(v, depth + 1)
  }
  return out
}

/**
 * Retorna uma CÓPIA redigida do evento (nunca muta a entrada). Seguro para persistir.
 * @param {object} event
 */
export function redactEvent(event) {
  if (!event || typeof event !== "object") return event
  return redactObject(event, 0)
}
