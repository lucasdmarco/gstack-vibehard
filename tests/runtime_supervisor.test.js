import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const supMod = path.join(repoRoot, "src", "runtime", "supervisor.js")
const portMod = path.join(repoRoot, "src", "runtime", "ports.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

// ── ports ──
test("allocatePort: pula portas ocupadas e retorna a primeira livre", async () => {
  const { allocatePort } = await imp(portMod)
  assert.equal(await allocatePort(5173, { isFree: async (p) => p === 5175 }), 5175)
  assert.equal(await allocatePort(3000, { isFree: async () => true }), 3000)
})

test("allocatePort: erra (não trava) quando nada livre", async () => {
  const { allocatePort } = await imp(portMod)
  await assert.rejects(() => allocatePort(3000, { isFree: async () => false, maxTries: 4 }), /nenhuma porta livre/)
})

// ── planStart: spawn SEM shell + env com porta alocada ──
test("planStart: command vira argv (sem shell), env recebe a porta alocada", async () => {
  const { planStart } = await imp(supMod)
  const manifest = { schemaVersion: 2, services: [
    { name: "web", command: ["pnpm", "dev:web"], cwd: ".", port: { preferred: 5173, env: "WEB_PORT", autoAllocate: true }, health: { readiness: { type: "http", path: "/", timeoutSeconds: 30 } } },
  ] }
  const plans = await planStart(manifest, { env: { BASE: "1" }, allocatePort: async () => 8080 })
  assert.equal(plans[0].file, "pnpm")
  assert.deepEqual(plans[0].args, ["dev:web"])
  assert.equal(plans[0].env.WEB_PORT, "8080", "porta alocada injetada via env")
  assert.equal(plans[0].env.BASE, "1", "env base preservado")
  assert.equal(plans[0].port, 8080)
  assert.equal(plans[0].readinessPath, "/")
  assert.equal(plans[0].readinessTimeout, 30)
})

// ── killTreeCommand: árvore por plataforma ──
test("killTreeCommand: Windows usa taskkill /T /F; POSIX mata o GRUPO (-pid)", async () => {
  const { killTreeCommand } = await imp(supMod)
  assert.deepEqual(killTreeCommand(123, "win32"), { file: "taskkill", args: ["/PID", "123", "/T", "/F"] })
  assert.deepEqual(killTreeCommand(123, "linux"), { file: "kill", args: ["-TERM", "-123"] })
})

// ── stopAll: invoca o kill por serviço, idempotente ──
test("stopAll: mata cada pid; lida com no-pid e processo já encerrado", async () => {
  const { stopAll } = await imp(supMod)
  const calls = []
  const exec = (file, args) => { if (args.includes("999")) throw new Error("not found"); calls.push([file, ...args].join(" ")) }
  const r = stopAll([{ name: "web", pid: 123 }, { name: "x", pid: null }, { name: "gone", pid: 999 }], { exec, platform: "win32" })
  assert.equal(r[0].status, "stopped")
  assert.equal(r[1].status, "no-pid")
  assert.equal(r[2].status, "already-gone")
  assert.deepEqual(calls, ["taskkill /PID 123 /T /F"])
})

// ── pollReadiness: ok / retry / timeout (sem esperar de verdade) ──
test("pollReadiness: 200 → ok; sempre falha → timeout (now/sleep injetados)", async () => {
  const { pollReadiness } = await imp(supMod)
  const ok = await pollReadiness("http://x/", { httpGet: async () => ({ status: 200 }) })
  assert.equal(ok.ok, true); assert.equal(ok.status, 200)

  let t = 0
  const to = await pollReadiness("http://x/", {
    httpGet: async () => { throw new Error("connrefused") },
    timeoutSeconds: 1, intervalMs: 100, sleep: async () => {}, now: () => (t += 300),
  })
  assert.equal(to.ok, false); assert.equal(to.timedOut, true)
})

test("pollReadiness: sobe na 2ª tentativa (retry conta)", async () => {
  const { pollReadiness } = await imp(supMod)
  let n = 0
  const r = await pollReadiness("http://x/", {
    httpGet: async () => { if (n++ === 0) throw new Error("nope"); return { status: 404 } },
    sleep: async () => {}, now: () => Date.now(),
  })
  assert.equal(r.ok, true, "404 = servidor de pé (ready); 2ª tentativa")
})

// ── state: write/read/clear num HOME temp ──
test("state: writeServiceState → readAllState → clearState", async () => {
  const { writeServiceState, readAllState, clearState } = await imp(supMod)
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-rt-"))
  try {
    writeServiceState(dir, "web", { name: "web", pid: 1, port: 5173, status: "ready" })
    writeServiceState(dir, "api", { name: "api", pid: 2, port: 3000, status: "ready" })
    const all = readAllState(dir)
    assert.equal(all.length, 2)
    assert.ok(all.find((s) => s.name === "web" && s.pid === 1))
    clearState(dir)
    assert.equal(readAllState(dir).length, 0)
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})
