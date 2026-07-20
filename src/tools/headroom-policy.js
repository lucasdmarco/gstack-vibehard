import { connect } from "net"
import { startProxy, proxyStatus, DEFAULT_PROXY_PORT } from "./headroom-proxy.js"
import { buildRoutedEnv } from "./headroom-traffic.js"

/**
 * Headroom Full Policy (PRD35 C3). No modo FULL o Headroom deixa de ser opt-in
 * passivo: o GStack AUTO-LIGA o proxy e ROTEIA os processos filhos por padrão
 * (opt-out explícito via `GSTACK_HEADROOM_ROUTE=off`). E o `callable_not_routed`
 * deixa de ser "estado aceitável": vira uma PENDÊNCIA a corrigir.
 *
 * Invariantes intactas: routing é sempre CHILD-scoped (nunca env global, nunca
 * config de harness, nunca `wrap`). "default-on" = o GStack roteia o que ELE
 * spawna no Full; jamais mexe no shell/harness do usuário. PURO/testável.
 */

export const HEADROOM_POLICY_SCHEMA = "gstack.headroom.policy.v1"

const OPTED_OUT = (env) => String((env || {}).GSTACK_HEADROOM_ROUTE || "").toLowerCase() === "off"

/** No Full (e sem opt-out), o routing child-scoped é default-on. */
export function routeDefaultOn({ mode = "full", env = {} } = {}) {
  return mode === "full" && !OPTED_OUT(env)
}

// Estados de readiness que, sob default-on, contam como pendência (não roteado de fato).
const NOT_ROUTED_STATES = new Set(["callable_not_routed", "installed_not_callable", "missing"])

/**
 * Sob default-on, `callable_not_routed` (e afins) é PENDÊNCIA a corrigir — não
 * estado aceitável. → { pending, action, note }. Fora do Full, opt-in é aceitável.
 */
export function headroomPendency({ status, onByDefault } = {}) {
  if (!onByDefault) return { pending: false, note: "routing é opt-in fora do Full — callable_not_routed é aceitável aqui" }
  if (status === "routed") return { pending: false, note: "routed e provado" }
  if (NOT_ROUTED_STATES.has(status)) {
    return {
      pending: true,
      action: "gstack_vibehard tools headroom start && gstack_vibehard tools headroom enable --harness claude|codex --project-only",
      note: `Full espera routing: '${status}' é PENDÊNCIA a corrigir (não estado aceitável)`,
    }
  }
  return { pending: false, note: `status '${status}' não é pendência de routing` }
}

/**
 * Garante o env roteado para um processo FILHO no Full: se default-on, sobe o
 * proxy (se preciso) e devolve o env child-scoped. Opt-out ou não-Full → não
 * roteia (honesto). NUNCA toca env global. deps injetáveis (start/status/build).
 */
const offReason = (env) => (OPTED_OUT(env) ? "opt-out (GSTACK_HEADROOM_ROUTE=off)" : "não-Full: routing é opt-in")

// Garante o proxy pronto (reusa se rodando, senão sobe). → up (com ready/port).
async function ensureProxyUp({ cwd, port, start, status }) {
  const st = await status({ cwd })
  if (st.state === "running") return { alreadyRunning: true, ready: true, host: st.host, port: st.port }
  return start({ cwd, port })
}

/**
 * PRD45 S45.4 (P1.4): PROBE DE TRÁFEGO real do proxy. `startProxy` marcava `ready` só porque a
 * porta abriu (waitPortReady) ou o PID estava vivo (alreadyRunning) — nunca provou que o proxy
 * ACEITA conexão. Aqui abrimos um socket loopback de verdade; sem isso, não afirmamos `routed`
 * (o achado central: "expor routed apenas após probe de tráfego"). Injetável para testes.
 */
export function defaultTrafficProbe({ host = "127.0.0.1", port, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const sock = connect({ host, port })
    const done = (ok, reason) => { sock.destroy(); resolve({ ok, reason }) }
    sock.setTimeout(timeoutMs, () => done(false, "probe timeout — proxy não respondeu"))
    sock.once("connect", () => done(true))
    sock.once("error", (e) => done(false, `probe falhou: ${e.code || e.message}`))
  })
}

const notRouted = (reason, baseEnv, proxy) => ({ routed: false, reason, env: baseEnv, ...(proxy ? { proxy } : {}) })
const proxyIsUp = (up) => up.ready === true || up.alreadyRunning === true
const trafficOk = (t) => Boolean(t) && t.ok === true
const failReason = (obj, fallback) => (obj && obj.reason) || fallback

// Sobe o proxy e prova tráfego. @returns { ok, up, reason? } — ok:true só com probe verde.
async function ensureProvenProxy({ cwd, port, start, status, probe }) {
  const up = await ensureProxyUp({ cwd, port, start, status })
  if (!proxyIsUp(up)) return { ok: false, up, reason: failReason(up, "proxy não ficou pronto") }
  const traffic = await probe({ host: up.host || "127.0.0.1", port: up.port || port })
  if (!trafficOk(traffic)) return { ok: false, up, reason: failReason(traffic, "proxy não provou tráfego") }
  return { ok: true, up }
}

export async function ensureRoutedChildEnv({
  cwd = process.cwd(), baseEnv = {}, mode = "full", env = process.env,
  port = DEFAULT_PROXY_PORT, harnesses = ["claude", "codex"],
  start = startProxy, status = proxyStatus, build = buildRoutedEnv, probe = defaultTrafficProbe,
} = {}) {
  // opt-out / não-Full curto-circuitam ANTES de subir/probar qualquer coisa.
  if (!routeDefaultOn({ mode, env })) return notRouted(offReason(env), baseEnv)
  // Fail-safe: sem proxy up + prova de tráfego, o env do FILHO fica intocado (dev sem routing).
  const proven = await ensureProvenProxy({ cwd, port, start, status, probe })
  if (!proven.ok) return notRouted(proven.reason, baseEnv, proven.up)
  const proxyUrl = `http://127.0.0.1:${proven.up.port || port}`
  const routed = build({ baseEnv, proxyUrl, harnesses })
  return { routed: true, env: routed.env, applied: routed.applied, proxyUrl, proxy: proven.up, note: "child-scoped; aplicar SÓ ao processo que o GStack spawna" }
}
