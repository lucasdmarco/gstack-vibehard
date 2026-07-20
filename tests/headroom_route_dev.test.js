import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.4 (P1.4) — Headroom default-on não chegava ao caminho real de `dev`, e o overlay
// dizia `routed:true` só porque a PORTA abriu / o PID estava vivo (nunca provou tráfego). Agora:
//   • ensureRoutedChildEnv só expõe routed:true APÓS um probe de tráfego real do proxy;
//     probe falho ⇒ routed:false, env base INTACTO (fail-safe — o dev roda sem routing);
//   • devRoutingOptions liga o routing child-scoped no dev (default-on no Full, opt-out
//     GSTACK_HEADROOM_ROUTE=off), nunca tocando config global.

const polMod = path.resolve(import.meta.dirname, "..", "src", "tools", "headroom-policy.js")
const supMod = path.resolve(import.meta.dirname, "..", "src", "commands", "runtime-supervisor.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

const upProxy = { status: async () => ({ state: "none" }), start: async () => ({ started: true, ready: true, port: 8787 }) }

test("routed EXIGE probe de tráfego: proxy up mas probe FALHA ⇒ routed:false, env base intacto", async () => {
  const { ensureRoutedChildEnv } = await imp(polMod)
  const baseEnv = { PATH: "/bin" }
  const r = await ensureRoutedChildEnv({
    cwd: "/proj", baseEnv, mode: "full", env: {}, ...upProxy,
    probe: async () => ({ ok: false, reason: "sem tráfego" }),
  })
  assert.equal(r.routed, false, "CONTROLE NEGATIVO: porta aberta não basta — sem probe não roteia")
  assert.equal(r.env.ANTHROPIC_BASE_URL, undefined, "fail-safe: env do filho fica INTACTO")
  assert.equal(r.reason, "sem tráfego")
})

test("routed com probe OK ⇒ env child-scoped roteado (e nunca muta o base)", async () => {
  const { ensureRoutedChildEnv } = await imp(polMod)
  const baseEnv = { PATH: "/bin" }
  const r = await ensureRoutedChildEnv({
    cwd: "/proj", baseEnv, mode: "full", env: {}, ...upProxy,
    probe: async () => ({ ok: true }),
  })
  assert.equal(r.routed, true)
  assert.equal(r.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787")
  assert.equal(baseEnv.ANTHROPIC_BASE_URL, undefined, "nunca muta o base (nada global)")
})

test("opt-out e não-Full curto-circuitam ANTES do probe (sem subir proxy)", async () => {
  const { ensureRoutedChildEnv } = await imp(polMod)
  let probed = 0
  const probe = async () => { probed++; return { ok: true } }
  const off = await ensureRoutedChildEnv({ mode: "full", env: { GSTACK_HEADROOM_ROUTE: "off" }, baseEnv: { X: 1 }, probe })
  assert.equal(off.routed, false)
  const lite = await ensureRoutedChildEnv({ mode: "lite", env: {}, baseEnv: { X: 1 }, probe })
  assert.equal(lite.routed, false)
  assert.equal(probed, 0, "probe nunca roda quando o routing está desligado")
})

test("devRoutingOptions: Full → routing habilitado; opt-out/Lite → desabilitado", async () => {
  const { devRoutingOptions } = await imp(supMod)
  assert.equal(devRoutingOptions({ mode: "full", env: {} }).enabled, true, "Full default-on")
  assert.equal(devRoutingOptions({ mode: "full", env: { GSTACK_HEADROOM_ROUTE: "off" } }).enabled, false, "opt-out respeitado")
  assert.equal(devRoutingOptions({ mode: "lite", env: {} }).enabled, false, "Lite não roteia")
})

test("devRoutingOptions carrega cwd/mode/env para o overlay (child-scoped, nunca global)", async () => {
  const { devRoutingOptions } = await imp(supMod)
  const o = devRoutingOptions({ mode: "full", env: { A: "1" }, cwd: "/p" })
  assert.equal(o.enabled, true)
  assert.equal(o.cwd, "/p")
  assert.equal(o.mode, "full")
})
