/**
 * Capability verdict canônico (PRD51 S51.5.4, ação #9).
 *
 * Reconcilia `tools readiness` (`src/tools/readiness.js`) e `agents doctor`
 * (`src/commands/agents.js` — `computeAgentsDoctor`) — hoje dois sistemas
 * TOTALMENTE separados que podem discordar em silêncio sobre "o projeto está
 * pronto?" (ex.: Headroom `callable_not_routed` some sem nunca cruzar com um
 * manifest de agentes com drift). Escopo HONESTO: a ação #9 do PRD nomeia só
 * esses dois — `tools doctor` (`src/printing-press/doctor.js`, CLIs de
 * terceiros instalados) é um domínio distinto e fica FORA deste veredito.
 *
 * Função PURA — recebe os dois relatórios já computados, nunca chama I/O.
 */
export const CAPABILITY_VERDICT_SCHEMA = "gstack.capability-verdict.v1"

// Status de `tools readiness` considerados bloqueantes pro veredito.
// `callable_not_routed` NUNCA bloqueia — routing do Headroom é sempre opt-in
// (mesmo invariante de `headroom-policy.js`).
const BLOCKING_TOOL_STATUSES = new Set(["missing", "installed_not_callable", "timeout_degraded"])

function readinessBlockers(readiness) {
  const tools = (readiness && readiness.tools) || {}
  return Object.entries(tools)
    .filter(([, t]) => BLOCKING_TOOL_STATUSES.has(t.status))
    .map(([name, t]) => ({ tool: name, status: t.status }))
}

const REASON_CHECKS = [
  (r) => (!r.compilerVersion ? "manifest.json ausente — rode `agents build`" : null),
  (r) => (r.drift ? `drift: ${r.drift}` : null),
  (r) => (r.contract && r.contract.missing > 0 ? `execution contract faltando em ${r.contract.missing} adapter(s)` : null),
]
const scorecardReasons = (r) => (r.scorecard && !r.scorecard.ok ? r.scorecard.errors || [] : [])

function agentsDoctorReasons(report) {
  if (!report) return ["agents doctor não rodou"]
  const reasons = REASON_CHECKS.map((check) => check(report)).filter(Boolean)
  return [...reasons, ...scorecardReasons(report)]
}

/** @param {{readiness: object, agentsDoctor: object}} input */
export function buildCapabilityVerdict({ readiness, agentsDoctor } = {}) {
  const toolsBlockers = readinessBlockers(readiness)
  const toolsOk = toolsBlockers.length === 0
  const agentsOk = !!(agentsDoctor && agentsDoctor.ok)
  return {
    schemaVersion: CAPABILITY_VERDICT_SCHEMA,
    ok: toolsOk && agentsOk,
    tools: { ok: toolsOk, blockers: toolsBlockers },
    agents: { ok: agentsOk, reasons: agentsOk ? [] : agentsDoctorReasons(agentsDoctor) },
    excludedFromScope: ["printing-press-doctor"],
  }
}
