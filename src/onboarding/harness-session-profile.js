/**
 * PRD48 S48.1 — Harness Session Profile (`gstack.harness-session-profile.v1`): contrato
 * normalizado e READ-ONLY sobre o que já existe (detecção real em `src/harness/
 * detector.js`, enforcement real via `harness-conformance-matrix.js`, S47.10). `auth` e
 * `models` SEMPRE ficam `unknown` nesta sprint — verificar login/listar modelos de um
 * harness de terceiro exigiria ler config sensível ou disparar rede/OAuth, o que o DoD
 * proíbe sem consentimento explícito. `unknown` nunca é promovido a `ready`/`known` por
 * omissão (mesma disciplina do `model-preflight.js`).
 */
export const HARNESS_SESSION_PROFILE_SCHEMA = "gstack.harness-session-profile.v1"

/**
 * Monta o perfil de UM harness a partir de sinais JÁ COLETADOS pelo caller (detecção +
 * enforcement). PURO — não sonda nada sozinho, não decide política, só normaliza.
 */
export function buildHarnessSessionProfile(harness, { installed = false, callable = false, enforcement = null, source = ["detector"] } = {}) {
  return {
    schemaVersion: HARNESS_SESSION_PROFILE_SCHEMA,
    harness,
    installed: Boolean(installed),
    callable: Boolean(callable),
    auth: "unknown",
    models: { status: "unknown", items: [] },
    enforcement,
    network: "provider_dependent",
    source: [...source],
    probedAt: new Date().toISOString(),
  }
}

/** Só harnesses instalados E chamáveis são "aptos" para o primeiro uso — nunca por omissão. */
export function aptHarnesses(profiles = []) {
  return profiles.filter((p) => p.installed && p.callable)
}
