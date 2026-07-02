import { classifyRisk, evaluateChallenge, buildChallenge } from "../vfa/challenge.js"
import { pretoolCheck } from "../vfa/pretool.js"
import { recordAction } from "../vfa/provenance.js"
import { getAdapterInfo } from "../agents/adapter-matrix.js"
import { section, success, warn, error, info } from "../cli/index.js"

function parseFlags(args) {
  const out = { evidence: {} }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--intent") out.intent = args[++i]
    else if (a === "--target") out.target = args[++i]
    else if (a === "--scope") out.scope = args[++i]
    else if (a === "--harness") out.harness = args[++i]
    else if (a === "--run") out.runId = args[++i]
    else if (a === "--sensitive") out.sensitive = true
    else if (a === "--evidence") {
      // consome MÚLTIPLOS tokens (até o próximo --flag): o cmd.exe/PowerShell quebra
      // `a,b,c` em args separados, então `--evidence a b c` e `--evidence a,b,c` valem.
      while (i + 1 < args.length && !String(args[i + 1]).startsWith("--")) {
        for (const e of String(args[++i]).split(",").map((s) => s.trim()).filter(Boolean)) out.evidence[e] = "provided"
      }
    }
  }
  return out
}

/**
 * `gstack_vibehard challenge <classify|evaluate> --intent <i> --target <t> [--scope global]
 * [--harness <id>] [--evidence k1,k2]` — gate de ação de alto risco. `evaluate` registra
 * a decisão no provenance (recibo encadeado). io injetável (opts.action/response) p/ teste.
 */
export function challengeCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-")) || "evaluate"
  const f = parseFlags(args)
  const action = opts.action || { intent: f.intent || "unknown", target: { scope: f.scope, pathOrName: f.target, sensitive: !!f.sensitive } }
  const enforcement = opts.enforcement || (f.harness ? getAdapterInfo(f.harness).enforcement : "real_hooks")

  if (sub === "classify") {
    const risk = classifyRisk(action)
    if (json) { process.stdout.write(JSON.stringify(risk) + "\n"); return risk }
    section("challenge classify")
    info(`  Risco: ${risk.level}${risk.rule ? ` (${risk.rule})` : ""}`)
    if (risk.requiredEvidence.length) info(`  Evidência exigida: ${risk.requiredEvidence.join(", ")}`)
    return risk
  }

  // pretool: chamado pelo hook PreToolUse (PRD14 §6.4). Allow por grant recente
  // (challenge evaluate aprovado) ou deny com o challenge + comando de resposta.
  if (sub === "pretool") {
    const decision = pretoolCheck(cwd, action, { harness: f.harness, now: opts.now, ttlMs: opts.ttlMs })
    if (json) { process.stdout.write(JSON.stringify(decision) + "\n"); return decision }
    section("challenge pretool")
    if (decision.decision === "allow") success(`  ✓ allow (risco ${decision.risk}${decision.grantedBy ? `, grant ${decision.grantedBy.slice(0, 12)}` : ""})`)
    else { error(`  ✗ DENY — ${decision.challenge}`); info(`  Responda com: ${decision.howTo}`); process.exitCode = 1 }
    return decision
  }

  // evaluate
  const response = opts.response || { evidence: f.evidence }
  const decision = evaluateChallenge(action, response, { enforcement })
  // registra a decisão no provenance (recibo encadeado; sem conteúdo cru)
  try {
    recordAction(cwd, {
      runId: f.runId || "challenge", intent: `challenge:${action.intent || "?"}`,
      actor: { harness: f.harness || "?", enforcement }, target: action.target,
      policy: { decision: decision.decision, rules: ["challenge-response", decision.rule].filter(Boolean) },
    })
  } catch { /* provenance best-effort */ }

  if (json) { process.stdout.write(JSON.stringify(decision) + "\n"); if (decision.decision === "deny") process.exitCode = 1; return decision }
  section("challenge evaluate")
  const ch = buildChallenge(action)
  if (ch) info(`  ${ch.challenge}`)
  if (decision.decision === "allow") success(`  ✓ allow (risco ${decision.risk})`)
  else if (decision.decision === "deny") { error(`  ✗ DENY — falta evidência: ${(decision.missing || []).join(", ")}`); process.exitCode = 1 }
  else warn(`  ⚠ ${decision.decision} — ${decision.note || "auditoria posterior"}`)
  return decision
}
