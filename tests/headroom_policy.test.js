import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD35 C3 — default-on no Full + callable_not_routed vira PENDÊNCIA. Routing
// sempre child-scoped (nunca env global). Opt-out via GSTACK_HEADROOM_ROUTE=off.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("routeDefaultOn: Full → on; opt-out (=off) → off; não-Full → off", async () => {
  const { routeDefaultOn } = await imp("src/tools/headroom-policy.js")
  assert.equal(routeDefaultOn({ mode: "full", env: {} }), true)
  assert.equal(routeDefaultOn({ mode: "full", env: { GSTACK_HEADROOM_ROUTE: "off" } }), false)
  assert.equal(routeDefaultOn({ mode: "lite", env: {} }), false)
})

test("headroomPendency: sob default-on, callable_not_routed é PENDÊNCIA com ação; routed não é", async () => {
  const { headroomPendency } = await imp("src/tools/headroom-policy.js")
  const pend = headroomPendency({ status: "callable_not_routed", onByDefault: true })
  assert.equal(pend.pending, true)
  assert.match(pend.action, /tools headroom start/)
  assert.equal(headroomPendency({ status: "routed", onByDefault: true }).pending, false)
  // fora do Full, opt-in é aceitável — não é pendência
  assert.equal(headroomPendency({ status: "callable_not_routed", onByDefault: false }).pending, false)
})

test("ensureRoutedChildEnv: Full → sobe proxy (se preciso) e devolve env child-scoped roteado", async () => {
  const { ensureRoutedChildEnv } = await imp("src/tools/headroom-policy.js")
  const baseEnv = { PATH: "/bin" }
  const r = await ensureRoutedChildEnv({
    cwd: "/proj", baseEnv, mode: "full", env: {},
    status: async () => ({ state: "none" }),
    start: async () => ({ started: true, ready: true, port: 8787 }),
  })
  assert.equal(r.routed, true)
  assert.equal(r.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787")
  assert.equal(baseEnv.ANTHROPIC_BASE_URL, undefined, "nunca muta o env base (nada global)")
})

test("ensureRoutedChildEnv: proxy já rodando → reusa (não sobe outro)", async () => {
  const { ensureRoutedChildEnv } = await imp("src/tools/headroom-policy.js")
  let started = 0
  const r = await ensureRoutedChildEnv({
    cwd: "/proj", mode: "full", env: {},
    status: async () => ({ state: "running", host: "127.0.0.1", port: 8790 }),
    start: async () => { started++; return { started: true, ready: true } },
  })
  assert.equal(started, 0)
  assert.equal(r.proxyUrl, "http://127.0.0.1:8790")
  assert.equal(r.routed, true)
})

test("ensureRoutedChildEnv: opt-out e não-Full → NÃO roteia (honesto, env base intacto)", async () => {
  const { ensureRoutedChildEnv } = await imp("src/tools/headroom-policy.js")
  const optOut = await ensureRoutedChildEnv({ mode: "full", env: { GSTACK_HEADROOM_ROUTE: "off" }, baseEnv: { X: "1" } })
  assert.equal(optOut.routed, false)
  assert.match(optOut.reason, /opt-out/)
  const lite = await ensureRoutedChildEnv({ mode: "lite", env: {}, baseEnv: { X: "1" } })
  assert.equal(lite.routed, false)
})

test("ensureRoutedChildEnv: proxy não fica pronto → routed:false honesto (env base, sem fingir)", async () => {
  const { ensureRoutedChildEnv } = await imp("src/tools/headroom-policy.js")
  const r = await ensureRoutedChildEnv({
    cwd: "/proj", mode: "full", env: {}, baseEnv: { X: "1" },
    status: async () => ({ state: "none" }),
    start: async () => ({ started: true, ready: false, reason: "porta não respondeu" }),
  })
  assert.equal(r.routed, false)
  assert.match(r.reason, /não respondeu/)
  assert.equal(r.env.X, "1", "devolve o env base intacto")
})

test("proof --profile full: callable_not_routed vira pendência + warning (não estado aceitável)", async () => {
  const { buildProof } = await imp("src/commands/proof.js")
  const deps = {
    verify: () => ({ status: "ready", failed: [], timedOut: [] }),
    dream: () => ({ summary: { REAL: 1, PARTIAL: 0, PLACEBO: 0, ROADMAP: 0, RISK: 0 } }),
    readiness: () => ({ tools: { headroom: { status: "callable_not_routed" }, graphify: { status: "callable" } }, graphify: { ok: true, state: "fresh" } }),
    git: () => null,
    skillGateRelease: () => ({ ok: true, pendingGates: [], blocker: null }),
    env: {},
  }
  const full = buildProof({ cwd: "/x", profile: "full", deps })
  assert.equal(full.checks.headroomRouting.pending, true)
  assert.ok(full.warnings.some((w) => /headroom.*PEND/i.test(w)))
  // release/opt-in: callable_not_routed NÃO é pendência
  const release = buildProof({ cwd: "/x", profile: "release", deps })
  assert.equal(release.checks.headroomRouting.pending, false)
  assert.ok(!release.warnings.some((w) => /headroom.*PEND/i.test(w)))
})
