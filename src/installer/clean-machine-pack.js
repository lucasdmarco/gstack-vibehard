/**
 * Clean-Machine Test Pack (PRD42 S42.13) — o AGREGADOR de veredito.
 *
 * Diferente do simulador offline (`clean-machine.js`, fixtures) e do runner de mantenedor
 * (`scripts/clean-machine-proof.mjs`): aqui consolidamos a jornada REAL do usuário final via
 * tarball instalado (create Lite/Full, start/dev/stop, doctor/verify/proof/dream, jornadas de
 * falha, checkpoint→rollback, uninstall→restore) num relatório `gstack.cleanmachine.v1` com
 * status POR CAPACIDADE e POR PLATAFORMA. Invariantes de honestidade inegociáveis:
 *
 *   • Só `passed` é VERDE. `not_applicable`, `blocked_missing_engine` e `not_run` NUNCA contam
 *     como aprovado nem inflam o placar (herda S42.8/S42.12).
 *   • Capacidade `unsupported` na plataforma corrente ⇒ `not_applicable` (documentado, nunca
 *     verde) — jamais "passa por omissão".
 *   • Backend REQUIRED com engine ausente ⇒ `blocked_missing_engine` ⇒ veredito
 *     `ready_engines_blocked` (parcial honesto), NUNCA "ready" liso nem "not_ready" por engine.
 *   • (PRD45 S45.0) Engine PRESENTE mas E2E real não executado ⇒ `not_proved` ⇒ veredito
 *     `capabilities_unproven`. Antes o pack fazia `dockerAvailable() ? "passed" : ...` —
 *     daemon de pé virava prova de RBAC/merge/persistência. Era falso-verde: `casdoor-rbac`
 *     ficava "passed" com o Casdoor em crash-loop. Presença de engine não prova capacidade.
 *   • Qualquer jornada FALHA ⇒ `not_ready`, por mais alto que seja o resto (a média não esconde P0).
 *   • Qualquer jornada `not_run` ⇒ `incomplete` — não rodar tudo não é "pronto".
 *
 * PURO / injetável — a execução real (spawn do bin) vive no script; aqui só se agrega.
 */
export const CLEANMACHINE_SCHEMA = "gstack.cleanmachine.v1"

export const CAP_STATUS = {
  PASSED: "passed",
  FAILED: "failed",
  BLOCKED_MISSING_ENGINE: "blocked_missing_engine",
  // PRD45 S45.0: engine PRESENTE, E2E real não executado. Distinto de
  // `blocked_missing_engine` (sem engine) e de `failed` (E2E rodou e reprovou).
  NOT_PROVED: "not_proved",
  NOT_APPLICABLE: "not_applicable",
}
export const JOURNEY_STATUS = { PASSED: "passed", FAILED: "failed", NOT_RUN: "not_run" }

// Suporte por plataforma: "supported" | "wsl_only" | "unsupported" | undefined(=desconhecido).
const platformSupportOf = (cap, platform) => (cap.platformSupport || {})[platform]

/** Uma linha de capacidade, resolvida contra a plataforma corrente. */
export function capabilityRow(cap = {}, platform = process.platform) {
  const support = platformSupportOf(cap, platform)
  if (support === "unsupported") {
    return { id: cap.id, required: !!cap.required, status: CAP_STATUS.NOT_APPLICABLE, reason: `não suportado em ${platform}` }
  }
  const result = cap.result || {}
  const status = result.status || CAP_STATUS.BLOCKED_MISSING_ENGINE // sem resultado = engine não provado
  return { id: cap.id, required: !!cap.required, status, reason: result.reason || support || null }
}

/** Uma jornada não declarada é `not_run` (nunca passa por omissão). */
const journeyRow = (j = {}) => ({ id: j.id, status: j.status || JOURNEY_STATUS.NOT_RUN, detail: j.detail || null })

const countBy = (rows, status) => rows.filter((r) => r.status === status).length

function summarize(caps, journeys) {
  return {
    capabilities: {
      passed: countBy(caps, CAP_STATUS.PASSED),
      failed: countBy(caps, CAP_STATUS.FAILED),
      blockedMissingEngine: countBy(caps, CAP_STATUS.BLOCKED_MISSING_ENGINE),
      notProved: countBy(caps, CAP_STATUS.NOT_PROVED),
      notApplicable: countBy(caps, CAP_STATUS.NOT_APPLICABLE),
      total: caps.length,
    },
    journeys: {
      passed: countBy(journeys, JOURNEY_STATUS.PASSED),
      failed: countBy(journeys, JOURNEY_STATUS.FAILED),
      notRun: countBy(journeys, JOURNEY_STATUS.NOT_RUN),
      total: journeys.length,
    },
  }
}

const hasRequiredFailure = (caps) => caps.some((c) => c.required && c.status === CAP_STATUS.FAILED)
const hasRequiredBlockedEngine = (caps) => caps.some((c) => c.required && c.status === CAP_STATUS.BLOCKED_MISSING_ENGINE)
const hasRequiredNotProved = (caps) => caps.some((c) => c.required && c.status === CAP_STATUS.NOT_PROVED)

/**
 * Veredito fail-closed. Falha real > incompletude > engine bloqueado > NÃO PROVADO > pronto.
 * `capabilities_unproven` fica ABAIXO de `ready_engines_blocked` de propósito: sem engine a
 * culpa é da máquina (parcial honesto); COM engine e sem E2E a culpa é nossa — o produto não
 * provou o que promete, e isso nunca pode sair como "ready".
 */
function overallVerdict(caps, journeys) {
  if (journeys.some((j) => j.status === JOURNEY_STATUS.FAILED) || hasRequiredFailure(caps)) return "not_ready"
  if (journeys.some((j) => j.status === JOURNEY_STATUS.NOT_RUN)) return "incomplete"
  if (hasRequiredBlockedEngine(caps)) return "ready_engines_blocked"
  if (hasRequiredNotProved(caps)) return "capabilities_unproven"
  return "ready"
}

/**
 * Consolida o relatório da máquina limpa.
 * @param {{platform?:string, capabilities?:Array, journeys?:Array}} input
 */
export function buildCleanMachineReport({ platform = process.platform, capabilities = [], journeys = [] } = {}) {
  const caps = capabilities.map((c) => capabilityRow(c, platform))
  const js = journeys.map(journeyRow)
  return {
    schema: CLEANMACHINE_SCHEMA,
    platform,
    verdict: overallVerdict(caps, js),
    summary: summarize(caps, js),
    capabilities: caps,
    journeys: js,
  }
}
