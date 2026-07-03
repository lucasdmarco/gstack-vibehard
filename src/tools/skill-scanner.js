import { redactSecrets } from "../security/redact.js"

/**
 * Scanner de qualidade/segurança para skills externas (PRD18 Sprint 8). Skills
 * NUNCA são bulk-installed: cada uma passa por este scanner antes de virar sugestão
 * forte. Bloqueia caminho absoluto (quebra portabilidade / vaza layout local) e
 * secret embutido.
 */

// Caminho absoluto Unix (/etc/…) ou Windows (C:\…). Ignora `//` de URL (http://).
const ABS_PATH = /(^|[\s"'`(=])(\/(?!\/)[A-Za-z0-9._-]+\/[^\s"'`)]*|[A-Za-z]:\\[^\s"'`)]+)/
const SECRET_HINT = /(api[_-]?key|secret|password|bearer\s+[a-z0-9]|BEGIN [A-Z ]*PRIVATE KEY)/i

/** @returns {{ name, ok, blocked, findings, quality }} */
export function scanSkill({ name = "?", content = "" } = {}) {
  const findings = []
  if (ABS_PATH.test(content)) findings.push({ kind: "absolute_path", detail: "caminho absoluto embutido — quebra portabilidade e pode vazar layout local" })
  const { count } = redactSecrets(content)
  if (count > 0 || SECRET_HINT.test(content)) findings.push({ kind: "secret", detail: "possível secret embutido — BLOQUEADO" })
  const blocked = findings.length > 0
  return { name, ok: !blocked, blocked, findings, quality: blocked ? "blocked" : "ok" }
}

/** Skills NUNCA são instaladas em massa — sempre uma a uma, com scanner antes. */
export function bulkInstallAllowed() { return false }

export function scanSkillCatalog(skills = []) {
  const scanned = skills.map(scanSkill)
  return { skills: scanned, blocked: scanned.filter((s) => s.blocked).length, bulkInstall: false }
}
