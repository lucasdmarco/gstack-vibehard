/**
 * Output Guard — estado HONESTO da cobertura (PRD14 §6.6).
 *
 * Duas camadas, sem claim falso:
 *  - pós-resposta (sempre ativa via hooks): AUDITORIA depois que o texto já
 *    apareceu — detecta vazamento, não impede a renderização;
 *  - pré-render (opt-in via `gstack_vibehard proxy`): interceptação REAL em
 *    trânsito, só onde o harness aceita base-URL custom.
 */

export const DEFAULT_PROXY_PORT = 8788

/** Matriz honesta de interceptação por harness (o que dá para prometer HOJE). */
export function interceptionMatrix() {
  return [
    { harness: "claude", interception: "env_base_url", how: "ANTHROPIC_BASE_URL=http://localhost:<porta>", preRender: true },
    { harness: "codex", interception: "env_base_url", how: "OPENAI_BASE_URL=http://localhost:<porta>/v1", preRender: true },
    { harness: "opencode", interception: "config_base_url", how: "provider.baseURL na config (manual)", preRender: true },
    { harness: "cursor", interception: "none", how: "sem base-URL custom — só auditoria pós-resposta", preRender: false },
    { harness: "instrucionais (gemini/windsurf/kiro/...)", interception: "none", how: "sem hook nem base-URL — só auditoria pós-resposta", preRender: false },
  ]
}

/** O proxy está OUVINDO na porta? (qualquer resposta = vivo; conexão recusada = não). */
export async function probeProxy(port = DEFAULT_PROXY_PORT, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 1500)
  try {
    await fetchImpl(`http://127.0.0.1:${port}/`, { signal: ctrl.signal })
    return true
  } catch (e) {
    // abort/timeout = porta ocupada mas lenta → considera vivo; ECONNREFUSED = morto
    return Boolean(e && e.name === "AbortError")
  } finally { clearTimeout(t) }
}

/** Quais env vars deste shell já apontam para o proxy local? */
export function envPointing(env = process.env, port = DEFAULT_PROXY_PORT) {
  const points = (v) => String(v || "").includes(`localhost:${port}`) || String(v || "").includes(`127.0.0.1:${port}`)
  return {
    anthropic: points(env.ANTHROPIC_BASE_URL),
    openai: points(env.OPENAI_BASE_URL),
  }
}

/**
 * Estado completo do guard. `coverage`:
 *  - "pre_render_partial": proxy vivo E pelo menos uma env apontando;
 *  - "posthoc_only": sem proxy em uso — auditoria pós-resposta apenas (default).
 */
async function resolveRunning(opts, port) {
  if (opts.probe != null) return opts.probe
  return probeProxy(port, opts)
}

export async function buildGuardStatus(opts = {}) {
  const port = opts.port || DEFAULT_PROXY_PORT
  const running = await resolveRunning(opts, port)
  const pointing = envPointing(opts.env || process.env, port)
  const inUse = running && (pointing.anthropic || pointing.openai)
  return {
    posthoc: { active: true, note: "hooks stop/output-guard auditam DEPOIS da resposta (detecção, não prevenção)" },
    preRender: { proxyRunning: running, port, envPointing: pointing, optIn: "gstack_vibehard proxy" },
    matrix: interceptionMatrix(),
    coverage: inUse ? "pre_render_partial" : "posthoc_only",
  }
}
