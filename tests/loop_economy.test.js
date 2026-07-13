import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD37 37.5/37.6 (D5, FECHA o programa) — prova de economia com Headroom REAL +
// honestidade do ciclo fechado. Economia só afirmada com ledger (calls>0 E
// tokens_saved>0); ciclo só validated com evidência de navegador. Nada é enfeite.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const provenRouting = { economyClaimable: true, state: "routed_proven", savings: { tokensSaved: 1200, savingsPercent: 30, calls: 5 } }
const noTrafficRouting = { economyClaimable: false, state: "routed_no_traffic", savings: { tokensSaved: 0, savingsPercent: 0, calls: 0 } }
const proxyOffRouting = { economyClaimable: false, state: "proxy_off", savings: null }

test("buildLoopEconomy: economia PROVADA pelo ledger → claimable com número", async () => {
  const { buildLoopEconomy } = await imp("src/skills/loop-economy.js")
  const state = { consumed: { tokens: 4000 } }
  const e = buildLoopEconomy({ state, routing: provenRouting, mode: "full" })
  assert.equal(e.claimable, true)
  assert.equal(e.tokensSaved, 1200)
  assert.equal(e.savingsPercent, 30)
  assert.equal(e.loopTokens, 4000)
  assert.equal(e.pendency, null)
  assert.match(e.note, /PROVADA/)
})

test("buildLoopEconomy: routed sem tráfego → NÃO afirma economia (calls=0)", async () => {
  const { buildLoopEconomy } = await imp("src/skills/loop-economy.js")
  const e = buildLoopEconomy({ state: { consumed: { tokens: 100 } }, routing: noTrafficRouting, mode: "full" })
  assert.equal(e.claimable, false)
  assert.equal(e.tokensSaved, 0)
  assert.match(e.note, /NÃO afirmada/)
})

test("buildLoopEconomy: no Full, proxy off vira PENDÊNCIA (não estado aceitável)", async () => {
  const { buildLoopEconomy } = await imp("src/skills/loop-economy.js")
  const eFull = buildLoopEconomy({ state: {}, routing: proxyOffRouting, mode: "full", env: {} })
  assert.equal(eFull.claimable, false)
  assert.ok(eFull.pendency, "no Full default-on há pendência")
  assert.equal(eFull.pendency.pending, true)
})

test("buildLoopEconomy: opt-out (GSTACK_HEADROOM_ROUTE=off) no Full → sem pendência", async () => {
  const { buildLoopEconomy } = await imp("src/skills/loop-economy.js")
  const e = buildLoopEconomy({ state: {}, routing: proxyOffRouting, mode: "full", env: { GSTACK_HEADROOM_ROUTE: "off" } })
  assert.equal(e.pendency.pending, false, "opt-out explícito não é pendência")
})

test("finalizeLoop: só 'validated' com evidência de navegador; economia é dado SEPARADO", async () => {
  const { finalizeLoop, buildLoopEconomy } = await imp("src/skills/loop-economy.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  const state = buildLoopState({ runId: "r", intent: "x", budget: { maxIterations: 3, maxWallTimeSeconds: 100 } })
  const econ = buildLoopEconomy({ state, routing: provenRouting, mode: "full" })
  const clean = finalizeLoop({ state, observation: { visualValidated: true, problems: [] }, economy: econ })
  assert.equal(clean.verdict, "validated")
  assert.equal(clean.validatedByBrowser, true)
  assert.equal(clean.economy.claimable, true)
  // rodar barato NUNCA valida sozinho o ciclo:
  const noObs = finalizeLoop({ state, observation: null, economy: econ })
  assert.equal(noObs.verdict, "degraded")
  assert.equal(noObs.validatedByBrowser, false)
  assert.match(noObs.honest, /NÃO fechado/)
})

test("CLI loop economy: integração real — reporta fechamento + economia honesta (exit 0)", async () => {
  const { loopCommand } = await imp("src/commands/loop.js")
  const { buildLoopState, persistLoopState } = await imp("src/skills/replit-loop.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-econcli-"))
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  try {
    // S41.4: fechar exige ter chegado ao diagnose (a ordem do Loop Engine) — sem isso é
    // invalid_transition. Persistimos já em `diagnose` com observação registrada.
    persistLoopState({ root: cwd, state: { ...buildLoopState({ runId: "e1", intent: "implementar x" }), phase: "diagnose", lastObservation: { visualValidated: false, problems: ["pendente"] } } })
    process.exitCode = 0
    process.stdout.write = (s) => { out += s; return true }
    await loopCommand(["economy", "--run", "e1", "--json"], { cwd })
  } finally { process.stdout.write = orig }
  const payload = JSON.parse(out.trim().split("\n").pop())
  assert.equal(payload.economy.schemaVersion, "gstack.loop-economy.v1")
  // sem proxy rodando nesta máquina → economia NÃO afirmada (honesto), não quebra:
  assert.equal(payload.economy.claimable, false)
  assert.ok(payload.final.honest)
  process.exitCode = 0
  await rm(cwd, { recursive: true, force: true })
})

test("CLI loop economy ANTES de diagnose → invalid_transition (P0.5, exit 1)", async () => {
  const { loopCommand } = await imp("src/commands/loop.js")
  const { buildLoopState, persistLoopState } = await imp("src/skills/replit-loop.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-econbad-"))
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  try {
    // estado fresco em `implement` (antes de diagnose) — fechar aqui é inválido
    persistLoopState({ root: cwd, state: buildLoopState({ runId: "b1", intent: "implementar x" }) })
    process.exitCode = 0
    process.stdout.write = (s) => { out += s; return true }
    await loopCommand(["economy", "--run", "b1", "--json"], { cwd })
  } finally { process.stdout.write = orig }
  const payload = JSON.parse(out.trim().split("\n").pop())
  assert.equal(payload.error, "invalid_transition")
  assert.equal(payload.from, "implement")
  assert.equal(payload.need, "diagnose")
  assert.equal(process.exitCode, 1, "ciclo fechado fora de ordem reprova")
  process.exitCode = 0
  await rm(cwd, { recursive: true, force: true })
})
