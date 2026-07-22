/**
 * PRD48 S48.1 — first-run: escolhe o executor real (harness) ANTES de reservar budget ou
 * iniciar o Golden Run. Nunca decide sozinho quando há mais de uma opção apta — pergunta
 * ao usuário (mesmo padrão do `wizard.js`, S42.1). Preferência só é persistida com
 * consentimento EXPLÍCITO (nunca via `--yes` silencioso — DoD do sprint).
 */
import { getHarness } from "../harness/detector.js"
import { publicLevelFor } from "../dream/harness-conformance-matrix.js"
import { buildHarnessRegistry } from "../dream/harness-registry.js"
import { buildHarnessSessionProfile, aptHarnesses } from "./harness-session-profile.js"
import { probeCommand } from "./harness-probes.js"

export const FIRST_RUN_SCHEMA = "gstack.first-run.v1"
export const LOCAL_PROFILE_SCHEMA = "gstack.local-profile.v1"
export const TARGET_HARNESSES = Object.freeze(["claude", "codex", "opencode"])

const VERSION_PROBE_TIMEOUT_MS = 3000

/** Detecta UM harness: config dir/CLI real (`detector.js`) OU probe `--version` bounded. */
function detectOne(id) {
  const harness = getHarness(id)
  if (harness && harness.detect()) return { installed: true, callable: true, source: ["config_dir_or_cli"] }
  const probe = probeCommand(id, ["--version"], { timeoutMs: VERSION_PROBE_TIMEOUT_MS })
  if (probe.state === "detected") return { installed: true, callable: true, source: ["probe"] }
  if (probe.state === "timeout") return { installed: false, callable: false, source: ["probe_timeout_degraded"] }
  return { installed: false, callable: false, source: ["probe_not_found"] }
}

/** Constrói os perfis reais dos harnesses-alvo (Claude/Codex/OpenCode) — nunca mockado. */
export function detectTargetProfiles(targets = TARGET_HARNESSES) {
  const registry = buildHarnessRegistry()
  const byId = new Map(registry.harnesses.map((h) => [h.id, h]))
  return targets.map((id) => {
    const d = detectOne(id)
    const enforcement = publicLevelFor(byId.get(id)?.adapter || null)
    return buildHarnessSessionProfile(id, { ...d, enforcement })
  })
}

/**
 * Decide o próximo passo do primeiro uso a partir dos perfis JÁ COLETADOS. Nenhum apto +
 * tarefa exige LLM -> `blocked` (nunca inventa executor). Nenhum apto + não exige LLM ->
 * `local_deterministic` (scout/gates seguem sem LLM). Exatamente um -> `auto_selected`.
 * Mais de um -> `ask_user` — NUNCA decide sozinho.
 */
export function decideFirstRun({ profiles = [], requiresLlm = true } = {}) {
  const apt = aptHarnesses(profiles)
  if (apt.length === 0) {
    if (!requiresLlm) return { schemaVersion: FIRST_RUN_SCHEMA, status: "local_deterministic", options: [] }
    return { schemaVersion: FIRST_RUN_SCHEMA, status: "blocked", reason: "nenhum executor apto e a tarefa exige LLM", options: [] }
  }
  if (apt.length === 1) return { schemaVersion: FIRST_RUN_SCHEMA, status: "auto_selected", harness: apt[0].harness, options: [apt[0].harness] }
  return { schemaVersion: FIRST_RUN_SCHEMA, status: "ask_user", options: apt.map((p) => p.harness) }
}

/** Aplica a escolha do usuário — só aceita harness REALMENTE apto, nunca por decreto. */
export function applyFirstRunChoice(profiles, chosenHarness) {
  const apt = aptHarnesses(profiles)
  if (!apt.some((p) => p.harness === chosenHarness)) {
    return { schemaVersion: FIRST_RUN_SCHEMA, status: "rejected", reason: `'${chosenHarness}' não está apto (instalado+chamável)` }
  }
  return { schemaVersion: FIRST_RUN_SCHEMA, status: "selected", harness: chosenHarness }
}

/**
 * Prepara a atualização do perfil local (`.gstack/config.local.json`, camada já real de
 * `policy/layers.js`). SÓ retorna algo com `consent:true` explícito — `--yes` de execução
 * NUNCA basta pra persistir preferência (DoD). Nunca inclui token/secret/OAuth.
 */
export function buildLocalProfileUpdate({ preferredHarness = null, preferredModel = "auto", consent = false } = {}) {
  if (!consent) return null
  return { schemaVersion: LOCAL_PROFILE_SCHEMA, preferredHarness, preferredModel }
}
