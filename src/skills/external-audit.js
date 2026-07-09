import { createHash } from "crypto"

/**
 * Auditoria READ-ONLY de skills externas (PRD29 29.5 / PRD34 F6-A).
 *
 * Skills de repos externos (ECC/Ruflo/AIDD/…) são REFERÊNCIA, nunca dependência
 * runtime do GStack (invariante do CLAUDE.md). Este módulo classifica cada
 * arquivo candidato de um MIRROR read-only em `adopt`/`adapt`/`avoid` com hash e
 * provenance — SEM NUNCA executar script externo, instalar nada ou ler `.env`.
 *
 *  - AVOID: sinal destrutivo/exec-remoto/exfiltração de secret/instalação →
 *    nunca adotar sem revisão humana explícita;
 *  - ADAPT: hook/rede/bloco de comando → rever e mapear a gate+agente antes de usar;
 *  - ADOPT: texto/skill declarativa sem sinal de risco.
 *
 * PURO/testável: recebe os arquivos já lidos (o mirror é responsabilidade do
 * comando). A leitura de conteúdo NUNCA é execução.
 */

export const EXTERNAL_AUDIT_SCHEMA = "gstack.external-skills-audit.v1"

// Sinais que forçam AVOID (a ordem = prioridade do motivo relatado).
const AVOID_SIGNALS = Object.freeze([
  { kind: "destructive", match: /rm\s+-rf|del\s+\/[fsq]|format\s|mkfs|shutdown|taskkill/i },
  { kind: "remote_exec", match: /curl[^\n]*\|\s*(ba)?sh|iwr[^\n]*\|\s*iex|Invoke-Expression|\beval\(/i },
  { kind: "secret_exfil", match: /\.env\b|AWS_SECRET|PRIVATE_KEY|process\.env\.[A-Z_]*(TOKEN|KEY|SECRET)/ },
  { kind: "install", match: /npm\s+install\s+-g|pip\s+install|curl[^\n]*install\.sh|iwr[^\n]*install/i },
])

// Sinais que exigem ADAPT (rever antes de usar).
const ADAPT_SIGNALS = Object.freeze([
  { kind: "hook", match: /pre_tool_use|post_tool_use|(^|[\/\\])hooks?[\/\\]/i },
  { kind: "network", match: /https?:\/\/|fetch\(|axios|requests\.(get|post)/i },
  { kind: "command_block", match: /```(bash|sh|powershell|cmd)/i },
])

const hitKinds = (signals, text) => signals.filter((s) => s.match.test(text)).map((s) => s.kind)
const decisionFor = (avoid, adapt) => (avoid.length ? "avoid" : adapt.length ? "adapt" : "adopt")
const RISK_BY_DECISION = Object.freeze({ avoid: "high", adapt: "medium", adopt: "low" })

/** Classifica um arquivo candidato do mirror. Nunca executa nada. */
export function classifyExternalFile(file) {
  const content = String(file.content || "")
  const avoid = hitKinds(AVOID_SIGNALS, content)
  const adapt = hitKinds(ADAPT_SIGNALS, content)
  const decision = decisionFor(avoid, adapt)
  return {
    path: file.path,
    hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    decision,
    risk: RISK_BY_DECISION[decision],
    reasons: decision === "avoid" ? avoid : decision === "adapt" ? adapt : [],
  }
}

function tally(decisions) {
  const counts = { adopt: 0, adapt: 0, avoid: 0 }
  for (const d of decisions) counts[d.decision]++
  return counts
}

/** Guardrails declarados — a auditoria é SEMPRE read-only. */
export const AUDIT_GUARDRAILS = Object.freeze({
  noExternalScriptsExecuted: true,
  noInstall: true,
  noGlobalHarnessConfigTouched: true,
  noGlobalMcpRegistered: true,
  envFilesRead: false,
  sourceCodeEdited: false,
})

/**
 * Audita os arquivos candidatos de um mirror read-only.
 * `files` = [{path, content}] já lidos; `source`/`commit` = provenance.
 */
export function auditExternalSkills({ source = null, commit = null, files = [] } = {}) {
  const decisions = files.map(classifyExternalFile).sort((a, b) => a.path.localeCompare(b.path))
  return {
    schemaVersion: EXTERNAL_AUDIT_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode: "read_only_snapshot_no_external_scripts",
    provenance: { source, commit, auditedFiles: decisions.length },
    guardrails: AUDIT_GUARDRAILS,
    counts: tally(decisions),
    decisions,
  }
}

/** Render markdown (resumo — o JSON é a fonte completa). */
export function renderAuditMarkdown(audit) {
  const c = audit.counts
  return [
    `# Auditoria de skills externas — ${audit.provenance.auditedFiles} arquivos`, "",
    `Fonte: ${audit.provenance.source || "(local)"} · commit ${audit.provenance.commit || "?"}`,
    `Gerado: ${audit.generatedAt} · schema ${audit.schemaVersion}`, "",
    `**adopt ${c.adopt} · adapt ${c.adapt} · avoid ${c.avoid}** (read-only, nada executado/instalado).`, "",
    "| Arquivo | Decisão | Risco | Motivo |", "|---|---|---|---|",
    ...audit.decisions.map((d) => `| ${d.path} | ${d.decision} | ${d.risk} | ${d.reasons.join(", ") || "—"} |`),
    "",
    "Skill externa é REFERÊNCIA, nunca dependência runtime do GStack.", "",
  ].join("\n")
}
