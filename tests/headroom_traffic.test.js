import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD35 C2 — routing SÓ do processo filho + PROVA de tráfego por evidência.
// Economia NUNCA é afirmada sem calls>0 no ledger do headroom (não é enfeite).

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// run fake do `headroom savings --json`.
const savingsRun = (lifetime) => (args) =>
  args[0] === "savings" ? { ok: true, stdout: JSON.stringify({ schema_version: 1, top_model: "claude", lifetime }) } : { ok: false }

test("buildRoutedEnv: env NOVO child-scoped; NUNCA muta baseEnv; openai ganha /v1", async () => {
  const { buildRoutedEnv } = await imp("src/tools/headroom-traffic.js")
  const baseEnv = { PATH: "/usr/bin", HOME: "/home/x" }
  const { env, applied } = buildRoutedEnv({ baseEnv, proxyUrl: "http://127.0.0.1:8787", harnesses: ["claude", "codex"] })
  assert.equal(env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787")
  assert.equal(env.OPENAI_BASE_URL, "http://127.0.0.1:8787/v1", "openai precisa do sufixo /v1")
  assert.equal(env.PATH, "/usr/bin", "preserva o env base")
  assert.deepEqual(applied.sort(), ["claude", "codex"])
  // NUNCA muta o objeto original
  assert.equal(baseEnv.ANTHROPIC_BASE_URL, undefined, "baseEnv intocado (nada global)")
})

test("readHeadroomSavings: parseia o ledger; JSON inválido/erro → available:false honesto", async () => {
  const { readHeadroomSavings } = await imp("src/tools/headroom-traffic.js")
  const ok = readHeadroomSavings({ run: savingsRun({ calls: 12, tokens_saved: 3400, tokens_before: 10000, savings_percent: 34 }) })
  assert.equal(ok.available, true)
  assert.equal(ok.calls, 12)
  assert.equal(ok.tokensSaved, 3400)
  assert.equal(ok.savingsPercent, 34)
  assert.equal(readHeadroomSavings({ run: () => ({ ok: true, stdout: "not json" }) }).available, false)
  assert.equal(readHeadroomSavings({ run: () => ({ ok: false, error: "exe missing" }) }).available, false)
})

test("proveRouting: proxy OFF → proxy_off, sem economia", async () => {
  const { proveRouting } = await imp("src/tools/headroom-traffic.js")
  const r = proveRouting({ proxyState: { state: "none" }, run: savingsRun({ calls: 99, tokens_saved: 999 }) })
  assert.equal(r.state, "proxy_off")
  assert.equal(r.routed, false)
  assert.equal(r.economyClaimable, false, "sem proxy rodando não afirma economia mesmo com ledger cheio")
})

test("proveRouting: proxy ON mas calls=0 → routed_no_traffic, economia=false (NÃO é enfeite)", async () => {
  const { proveRouting } = await imp("src/tools/headroom-traffic.js")
  const r = proveRouting({ proxyState: { state: "running" }, run: savingsRun({ calls: 0, tokens_saved: 0, savings_percent: 0 }) })
  assert.equal(r.state, "routed_no_traffic")
  assert.equal(r.routed, true, "o proxy está roteando, só não houve tráfego ainda")
  assert.equal(r.economyClaimable, false)
  assert.match(r.note, /NENHUMA economia/)
})

test("proveRouting: proxy ON + calls>0 + tokens_saved>0 → routed_proven, economia PROVADA", async () => {
  const { proveRouting } = await imp("src/tools/headroom-traffic.js")
  const r = proveRouting({ proxyState: { state: "running" }, run: savingsRun({ calls: 8, tokens_saved: 2500, tokens_before: 9000, savings_percent: 27.8 }) })
  assert.equal(r.state, "routed_proven")
  assert.equal(r.economyClaimable, true)
  assert.equal(r.savings.calls, 8)
  assert.equal(r.savings.tokensSaved, 2500)
  assert.match(r.note, /economia PROVADA.*2500 tokens.*27.8%.*8 chamada/)
})

test("proveRouting: proxy ON mas savings indisponível → savings_unavailable, sem economia", async () => {
  const { proveRouting } = await imp("src/tools/headroom-traffic.js")
  const r = proveRouting({ proxyState: { state: "running" }, run: () => ({ ok: false, error: "headroom sumiu" }) })
  assert.equal(r.state, "savings_unavailable")
  assert.equal(r.economyClaimable, false)
})

test("proveRouting: calls>0 mas tokens_saved=0 → routed_proven mas economia NÃO afirmável", async () => {
  const { proveRouting } = await imp("src/tools/headroom-traffic.js")
  const r = proveRouting({ proxyState: { state: "running" }, run: savingsRun({ calls: 5, tokens_saved: 0, savings_percent: 0 }) })
  assert.equal(r.state, "routed_proven")
  assert.equal(r.economyClaimable, false, "houve tráfego mas zero economia — honesto: não afirma economia")
})
