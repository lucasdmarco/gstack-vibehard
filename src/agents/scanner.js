/**
 * AgentShield — scanner DETERMINÍSTICO de prompt-injection (PRD 13 PR13.2). Roda
 * sobre a FONTE e o GERADO, em build E em `--check` (uma injeção commitada NÃO
 * pode passar pelo gate do CI). ECC AgentShield é cobertura ADICIONAL; sem ele o
 * resultado é `reduced_coverage`, nunca `pass` pleno. PURO/testável.
 *
 * Severidade: CRITICO bloqueia sempre; ALTO bloqueia no modo strict (CI release/Full).
 */

export const INJECTION_PATTERNS = Object.freeze([
  { id: "instruction-override", pattern: /ignore (all )?(previous|prior|above) instructions/i, severity: "CRITICO", description: "Tentativa de override de instrução" },
  { id: "disregard", pattern: /disregard (your|all|any) (previous|prior|system)/i, severity: "CRITICO", description: "Disregard de policies/instruções" },
  { id: "system-prompt-override", pattern: /system.?prompt.?(override|injection)/i, severity: "CRITICO", description: "Override do system prompt" },
  { id: "exfiltration", pattern: /exfiltrat(e|ion)/i, severity: "CRITICO", description: "Exfiltração de dados" },
  { id: "identity-override", pattern: /you are (now |not |no longer )?(gpt|claude|an? ai|the assistant)\b/i, severity: "ALTO", description: "Override de identidade" },
  { id: "read-env", pattern: /\b(cat|read|open|print|show|leak|send)\b[^.\n]{0,24}\.env\b/i, severity: "ALTO", description: "Leitura/uso de .env" },
  { id: "curl-env", pattern: /curl[^\n]*(--data|-d|-F|--upload)[^\n]*\benv\b/i, severity: "ALTO", description: "Exfiltração de env via curl" },
  { id: "disable-gate", pattern: /\b(disable|skip|bypass|ignore|turn off)\b[^.\n]{0,24}(quality gate|fallow|\bqg\b|publish-guard|pre.?tool|hooks?)/i, severity: "ALTO", description: "Pedido para desabilitar o QG/hooks" },
  { id: "system-prompt-leak", pattern: /\b(reveal|print|show|leak|repeat|output)\b[^.\n]{0,24}system.?prompt/i, severity: "ALTO", description: "Vazamento do system prompt" },
  { id: "destructive", pattern: /rm\s+-rf\s+[~/]|del\s+\/[sfq]|format\s+c:|drop\s+database/i, severity: "ALTO", description: "Comando destrutivo" },
  { id: "excessive-perm", pattern: /chmod\s+777|sudo\s+su\b|--dangerously/i, severity: "BAIXO", description: "Permissão excessiva (revisar)" },
  { id: "env-access", pattern: /process\.env/i, severity: "BAIXO", description: "Acesso a env no conteúdo (revisar)" },
])

function findLine(content, index) {
  if (index == null) return -1
  return (content.slice(0, index).match(/\n/g) || []).length + 1
}

/** Escaneia um texto. → [{file, id, severity, description, match, line}]. */
export function scanContent(file, content, patterns = INJECTION_PATTERNS) {
  const findings = []
  const text = String(content == null ? "" : content)
  for (const rule of patterns) {
    const m = text.match(rule.pattern)
    if (m) findings.push({ file, id: rule.id, severity: rule.severity, description: rule.description, match: String(m[0]).slice(0, 120), line: findLine(text, m.index) })
  }
  return findings
}

/** Escaneia um conjunto de arquivos. `files`: [{rel, content}]. */
export function scanFiles(files, patterns = INJECTION_PATTERNS) {
  const out = []
  for (const f of files || []) out.push(...scanContent(f.rel, f.content, patterns))
  return out
}

/**
 * Avalia o gate. `strict` bloqueia ALTO além de CRITICO. `coverage` = "full" (ECC
 * + builtin) ou "reduced" (só builtin). → { critical, high, blocked, verdict, coverage }.
 */
export function evaluateScan(findings, { strict = false, coverage = "reduced" } = {}) {
  const critical = (findings || []).filter((f) => f.severity === "CRITICO").length
  const high = (findings || []).filter((f) => f.severity === "ALTO").length
  const blocked = critical > 0 || (strict && high > 0)
  return { critical, high, blocked, coverage, verdict: blocked ? "BLOQUEADO" : (coverage === "full" ? "APROVADO" : "APROVADO_COBERTURA_REDUZIDA") }
}
