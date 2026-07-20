import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("proveEconomyDelta: delta positivo por run → claimable com número", async () => {
  const { proveEconomyDelta } = await imp("src/tools/headroom-run.js")
  const before = { available: true, calls: 10, tokensSaved: 1000 }
  const after = { available: true, calls: 13, tokensSaved: 1450 }
  const r = proveEconomyDelta({ before, after, runId: "run1" })
  assert.equal(r.claimable, true)
  assert.equal(r.runId, "run1")
  assert.deepEqual(r.delta, { calls: 3, tokensSaved: 450 })
  assert.match(r.note, /450 tokens em 3/)
})

test("proveEconomyDelta: sem delta de chamadas → NÃO afirma economia", async () => {
  const { proveEconomyDelta } = await imp("src/tools/headroom-run.js")
  const snap = { available: true, calls: 10, tokensSaved: 1000 }
  const r = proveEconomyDelta({ before: snap, after: snap, runId: "run2" })
  assert.equal(r.claimable, false)
  assert.equal(r.state, "no_delta")
  assert.deepEqual(r.delta, { calls: 0, tokensSaved: 0 })
})

test("proveEconomyDelta: tokens sem crescer (calls+ mas tokens=0) → não claimable", async () => {
  const { proveEconomyDelta } = await imp("src/tools/headroom-run.js")
  const r = proveEconomyDelta({ before: { available: true, calls: 1, tokensSaved: 100 }, after: { available: true, calls: 4, tokensSaved: 100 } })
  assert.equal(r.claimable, false, "delta de tokens = 0 não afirma economia")
})

test("proveEconomyDelta: savings indisponível → não claimable, honesto", async () => {
  const { proveEconomyDelta } = await imp("src/tools/headroom-run.js")
  const r = proveEconomyDelta({ before: { available: false }, after: { available: true, calls: 5, tokensSaved: 50 } })
  assert.equal(r.claimable, false)
  assert.equal(r.state, "savings_unavailable")
})

test("proxyPortOwnership: porta ocupada por ALHEIO → foreign/abort (NÃO mata) — negativo obrigatório", async () => {
  const { proxyPortOwnership } = await imp("src/tools/headroom-run.js")
  // nosso proxy tem pid 1000; a porta está com pid 9999 (processo de terceiro)
  const r = proxyPortOwnership({ manifest: { pid: 1000, startedAt: new Date().toISOString() }, holder: { pid: 9999, ageSec: 5 } })
  assert.equal(r.ownedByUs, false)
  assert.equal(r.state, "foreign")
  assert.equal(r.action, "abort", "jamais reutiliza/mata processo alheio na porta")
})

test("proxyPortOwnership: sem manifesto nosso mas porta ocupada → foreign/abort", async () => {
  const { proxyPortOwnership } = await imp("src/tools/headroom-run.js")
  const r = proxyPortOwnership({ manifest: null, holder: { pid: 4321 } })
  assert.equal(r.action, "abort")
  assert.equal(r.state, "foreign")
})

test("proxyPortOwnership: porta livre → start; nosso PID+idade batem → reuse", async () => {
  const { proxyPortOwnership } = await imp("src/tools/headroom-run.js")
  assert.equal(proxyPortOwnership({ manifest: { pid: 1 }, holder: null }).action, "start")
  const started = new Date(Date.now() - 3000).toISOString()
  const ours = proxyPortOwnership({ manifest: { pid: 1000, startedAt: started }, holder: { pid: 1000, ageSec: 3 } })
  assert.equal(ours.action, "reuse")
  assert.equal(ours.ownedByUs, true)
})

// ── Chamador de PRODUÇÃO: supervisor.planStart roteia o env do child ─────────────
test("planStart SEM routing → env do child intocado (zero alteração), global preservado", async () => {
  const { planStart } = await imp("src/runtime/supervisor.js")
  const manifest = { services: [{ name: "web", command: ["node", "server.js"], secretRefs: [] }] }
  const before = { ...process.env }
  const plans = await planStart(manifest, { env: {} })
  assert.equal(plans[0].env.ANTHROPIC_BASE_URL, undefined, "sem opt-in, nenhuma var de proxy")
  assert.deepEqual({ ...process.env }, before, "process.env global nunca é mutado")
})

test("planStart COM routing (Full+opt-in) → child recebe env roteado; global intacto", async () => {
  const { planStart } = await imp("src/runtime/supervisor.js")
  const manifest = { services: [{ name: "web", command: ["node", "server.js"], secretRefs: [] }] }
  const before = { ...process.env }
  // stubs: proxy já rodando + probe de tráfego OK → env roteado child-scoped.
  // PRD45 S45.4 (P1.4): `routed` agora exige prova de tráfego (probe injetável).
  const routing = {
    enabled: true, mode: "full", env: {}, cwd: repoRoot,
    status: async () => ({ state: "running", host: "127.0.0.1", port: 8787 }),
    start: async () => ({ ready: true, port: 8787 }),
    probe: async () => ({ ok: true }),
  }
  const plans = await planStart(manifest, { env: {}, routing })
  assert.equal(plans[0].env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787", "child roteado (child-scoped)")
  assert.deepEqual({ ...process.env }, before, "routing é child-scoped — global NUNCA muda")
})
