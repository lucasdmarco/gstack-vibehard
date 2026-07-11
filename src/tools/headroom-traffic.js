import { execFileSync } from "child_process"
import { projectHeadroomExe } from "./headroom-proxy.js"

/**
 * Headroom Traffic & Proof (PRD35 C2). Duas coisas HONESTAS:
 *
 *  1. Routing SÓ DO PROCESSO FILHO: `buildRoutedEnv` devolve um env NOVO (nunca
 *     muta o do usuário nem toca config global) apontando as base-URLs para o
 *     proxy local. O GStack aplica isso APENAS a processos que ELE spawna.
 *
 *  2. PROVA de tráfego por EVIDÊNCIA: o headroom mantém um ledger de economia
 *     (`headroom savings --json`) com `calls`/`tokens_saved`/`savings_percent`.
 *     A economia SÓ é afirmada quando `calls > 0` (LLM real passou pelo proxy).
 *     Sem tráfego provado, NADA de economia — é o "não é enfeite" do usuário.
 *
 * PURO/testável: runner/status injetáveis.
 */

export const HEADROOM_TRAFFIC_SCHEMA = "gstack.headroom.traffic.v1"

// base-URL que cada harness respeita (openai precisa do sufixo /v1).
const HARNESS_BASE_URL = Object.freeze({
  claude: (url) => ({ ANTHROPIC_BASE_URL: url }),
  codex: (url) => ({ OPENAI_BASE_URL: `${url.replace(/\/$/, "")}/v1` }),
})

/**
 * Env NOVO para um processo FILHO roteado pelo proxy. Nunca muta `baseEnv` nem
 * escreve nada global — só devolve o objeto para o GStack passar ao child.
 */
export function buildRoutedEnv({ baseEnv = {}, proxyUrl, harnesses = ["claude", "codex"] } = {}) {
  const env = { ...baseEnv }
  const applied = []
  for (const h of harnesses) {
    const make = HARNESS_BASE_URL[h]
    if (!make) continue
    Object.assign(env, make(proxyUrl))
    applied.push(h)
  }
  return { env, applied, proxyUrl, note: "routing project/child-scoped — aplicar SÓ a processos que o GStack spawna; nunca ao shell/config global" }
}

// Runner default: chama o headroom do venv com --json (bounded, sem shell).
function defaultRun(cwd) {
  return (args) => {
    try {
      const out = execFileSync(projectHeadroomExe(cwd), args, { encoding: "utf-8", timeout: 15000, shell: false })
      return { ok: true, stdout: out }
    } catch (e) { return { ok: false, stdout: e.stdout ? String(e.stdout) : "", error: e.message || String(e) } }
  }
}

const numOr0 = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/**
 * Lê o ledger de economia do headroom (`savings --json`). @returns
 * { available, calls, tokensSaved, tokensBefore, savingsPercent } | { available:false }.
 */
function parseSavings(data) {
  const life = data.lifetime || {}
  return {
    available: true,
    calls: numOr0(life.calls),
    tokensSaved: numOr0(life.tokens_saved),
    tokensBefore: numOr0(life.tokens_before),
    savingsPercent: numOr0(life.savings_percent),
    topModel: data.top_model || "unknown",
  }
}

export function readHeadroomSavings({ cwd = process.cwd(), run } = {}) {
  const res = (run || defaultRun(cwd))(["savings", "--json"])
  if (!res.ok || !res.stdout) return { available: false, reason: res.error || "headroom savings indisponível" }
  try { return parseSavings(JSON.parse(res.stdout)) }
  catch { return { available: false, reason: "savings --json não retornou JSON" } }
}

// Verdito honesto do routing a partir do proxy (C1) + ledger de economia.
function routingVerdict(proxyRunning, savings) {
  if (!proxyRunning) return { routed: false, state: "proxy_off", economyClaimable: false }
  if (!savings.available) return { routed: false, state: "savings_unavailable", economyClaimable: false }
  if (savings.calls <= 0) return { routed: true, state: "routed_no_traffic", economyClaimable: false }
  return { routed: true, state: "routed_proven", economyClaimable: savings.tokensSaved > 0 }
}

/**
 * Prova o routing por evidência: proxy rodando (C1) + ledger de economia. Só
 * afirma economia com `calls > 0` E `tokens_saved > 0`. NUNCA finge números.
 */
export function proveRouting({ cwd = process.cwd(), proxyState = null, run } = {}) {
  const proxyRunning = Boolean(proxyState && proxyState.state === "running")
  const savings = readHeadroomSavings({ cwd, run })
  const verdict = routingVerdict(proxyRunning, savings)
  return {
    schemaVersion: HEADROOM_TRAFFIC_SCHEMA,
    generatedAt: new Date().toISOString(),
    proxyRunning,
    ...verdict,
    savings: savings.available ? { calls: savings.calls, tokensSaved: savings.tokensSaved, savingsPercent: savings.savingsPercent, topModel: savings.topModel } : null,
    note: verdict.economyClaimable
      ? `economia PROVADA pelo ledger: ${savings.tokensSaved} tokens (${savings.savingsPercent}%) em ${savings.calls} chamada(s)`
      : "sem tráfego LLM provado pelo proxy — NENHUMA economia é afirmada (não é enfeite)",
  }
}
