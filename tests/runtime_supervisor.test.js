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
  const plans = await planStart(manifest, { envSource: { PATH: "/usr/bin" }, allocatePort: async () => 8080 })
  assert.equal(plans[0].file, "pnpm")
  assert.deepEqual(plans[0].args, ["dev:web"])
  assert.equal(plans[0].env.WEB_PORT, "8080", "porta alocada injetada via env")
  assert.equal(plans[0].env.PATH, "/usr/bin", "base OS-essencial (PATH) preservada")
  assert.equal(plans[0].port, 8080)
  assert.equal(plans[0].readinessPath, "/")
  assert.equal(plans[0].readinessTimeout, 30)
})

// ── ABUSO fix1: env por ALLOWLIST — só base OS + porta + segredos DECLARADOS ──
test("planStart: NÃO vaza env arbitrário; só secretRefs declarados chegam ao serviço", async () => {
  const { planStart } = await imp(supMod)
  const source = { PATH: "/usr/bin", DATABASE_URL: "postgres://sec", RANDOM_TOKEN: "nope-xyz", HOME: "/home/x" }
  const manifest = { schemaVersion: 2, services: [
    { name: "api", command: ["node", "x.js"], cwd: ".", secretRefs: ["DATABASE_URL"],
      port: { preferred: 3000, env: "API_PORT", autoAllocate: true } },
  ] }
  const plans = await planStart(manifest, { envSource: source, allocatePort: async () => 3000 })
  const env = plans[0].env
  assert.equal(env.PATH, "/usr/bin", "base OS passa")
  assert.equal(env.HOME, "/home/x", "base OS passa")
  assert.equal(env.API_PORT, "3000", "porta passa")
  assert.equal(env.DATABASE_URL, "postgres://sec", "segredo DECLARADO em secretRefs passa")
  assert.equal(env.RANDOM_TOKEN, undefined, "var arbitrária NÃO declarada NÃO passa (anti-leak)")
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
  // taskkill de pid inexistente sai com erro; ESRCH-like ⇒ status tipado already_gone (S45.1).
  const exec = (file, args) => { if (args.includes("999")) throw Object.assign(new Error("not found"), { code: "ESRCH" }); calls.push([file, ...args].join(" ")) }
  const r = stopAll([{ name: "web", pid: 123 }, { name: "x", pid: null }, { name: "gone", pid: 999 }], { exec, platform: "win32" })
  assert.equal(r[0].status, "stopped")
  assert.equal(r[1].status, "no_pid")
  assert.equal(r[2].status, "already_gone")
  assert.deepEqual(calls, ["taskkill /PID 123 /T /F"])
})

// ── stopAll POSIX: caminho NATIVO mata o GRUPO via process.kill(-pid) ──
test("stopAll: POSIX sem exec usa process.kill(-pid) (grupo), não o binário", async () => {
  const { stopAll } = await imp(supMod)
  const calls = []
  const kill = (pid, sig) => { if (pid === -999) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); calls.push(`${pid}/${sig}`) }
  // PRD51 S51.1: a probe de liveness decide o status. Em produção `process.kill(pid,0)`
  // lança ESRCH se o processo morreu; aqui o `isAlive` injetado reflete que ambos
  // morreram após o kill (caso feliz) — o mock de `kill` não modela liveness.
  const r = stopAll([{ name: "web", pid: 5760 }, { name: "gone", pid: 999 }], { kill, platform: "linux", isAlive: () => false })
  assert.equal(r[0].status, "stopped")
  assert.equal(r[1].status, "already_gone", "grupo inexistente vira already_gone (probe: morto)")
  assert.deepEqual(calls, ["-5760/SIGTERM"], "mata o GRUPO (-pid), nunca o binário kill")
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
    httpGet: async () => { if (n++ === 0) throw new Error("nope"); return { status: 200 } },
    sleep: async () => {}, now: () => Date.now(),
  })
  assert.equal(r.ok, true, "200 na 2ª tentativa = ready")
})

// ── ABUSO fix6: 4xx/5xx NÃO é saudável (404 na rota de health não é "de pé") ──
test("pollReadiness: 404 e 503 NÃO contam como ready → timeout", async () => {
  const { pollReadiness } = await imp(supMod)
  let t = 0
  const r404 = await pollReadiness("http://x/", {
    httpGet: async () => ({ status: 404 }),
    timeoutSeconds: 1, intervalMs: 100, sleep: async () => {}, now: () => (t += 300),
  })
  assert.equal(r404.ok, false, "404 não é ready")
  assert.equal(r404.timedOut, true)
  t = 0
  const r503 = await pollReadiness("http://x/", {
    httpGet: async () => ({ status: 503 }),
    timeoutSeconds: 1, intervalMs: 100, sleep: async () => {}, now: () => (t += 300),
  })
  assert.equal(r503.ok, false, "503 não é ready")
  // 301 (redirect) AINDA é de-pé
  const r301 = await pollReadiness("http://x/", { httpGet: async () => ({ status: 301 }) })
  assert.equal(r301.ok, true, "3xx = de pé")
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

// ── ABUSO fix1: state file NUNCA grava env/segredo (whitelist de campos) ──
test("writeServiceState: descarta env e campos não-whitelistados (anti-leak em disco)", async () => {
  const { writeServiceState, readAllState, clearState, pickState } = await imp(supMod)
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-st-"))
  try {
    writeServiceState(dir, "web", {
      name: "web", pid: 9, port: 5173, status: "ready",
      env: { SECRET: "leak-me" }, password: "p4ss", token: "abc",
    })
    const raw = readAllState(dir)[0]
    assert.equal(raw.name, "web")
    assert.equal(raw.env, undefined, "env NÃO vai pro disco")
    assert.equal(raw.password, undefined, "campo arbitrário NÃO vai pro disco")
    assert.equal(raw.token, undefined)
    // pickState é a barreira pura
    const picked = pickState({ name: "x", env: { A: 1 }, nope: 1, status: "ok" })
    assert.deepEqual(Object.keys(picked).sort(), ["name", "status"])
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

// ── ABUSO fix2: nome com path-traversal é REJEITADO (não escreve fora do dir) ──
test("writeServiceState: nome com '..'/separador é rejeitado (anti path-traversal)", async () => {
  const { writeServiceState, isValidServiceName, assertWithin } = await imp(supMod)
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-pt-"))
  try {
    assert.equal(isValidServiceName("web"), true)
    assert.equal(isValidServiceName("../../../PWNED"), false)
    assert.equal(isValidServiceName("a/b"), false)
    assert.equal(isValidServiceName("a\\b"), false)
    assert.throws(() => writeServiceState(dir, "../../../PWNED", { name: "x", status: "ready" }), /inválido/)
    assert.throws(() => assertWithin(dir, path.join(dir, "..", "escape.json")), /fora do runtime/)
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

// ── ABUSO fix5: stop NÃO mata PID reusado/foreign (valida idade do processo) ──
test("isProcessOurs + stopAll: pid reusado (idade divergente) é PULADO, não morto", async () => {
  const { isProcessOurs, stopAll } = await imp(supMod)
  const now = Date.parse("2026-06-25T12:00:10Z") // 10s após o registro
  const ours = { startedAt: "2026-06-25T12:00:00Z" }
  assert.equal(isProcessOurs(ours, 10, now), true, "idade ~10s bate com o esperado")
  assert.equal(isProcessOurs(ours, 99999, now), false, "processo MUITO mais velho = pid reusado")
  assert.equal(isProcessOurs(ours, null, now), true, "idade ilegível → procede AUDITADO (unverified_age)")
  // PRD45 S45.1 (P1.1): sem startedAt = baseline não-verificável ⇒ fail-closed (antes era true).
  // O comportamento foi ENDURECIDO de propósito; a cobertura do caso vive em
  // tests/runtime_stop_ownership.test.js (skipped_unverified).
  assert.equal(isProcessOurs({}, 5, now), false, "sem startedAt → NÃO-nosso (fail-closed)")

  const killed = []
  const r = stopAll(
    [{ name: "web", pid: 100, startedAt: "2026-06-25T12:00:00Z" }, { name: "old", pid: 200, startedAt: "2026-06-25T12:00:00Z" }],
    {
      kill: (pid) => killed.push(pid), platform: "linux",
      getAgeSec: (pid) => (pid === 200 ? 99999 : 10), // pid 200 = foreign
      // now padrão; tolera diferença real — o teste usa idade absurda p/ 200
    },
  )
  assert.equal(r.find((x) => x.name === "old").status, "skipped_foreign", "pid foreign pulado")
  assert.ok(!killed.includes(200), "NÃO matou o foreign")
})

// ── fix4: isAlive (signal 0) detecta processo vivo/morto ──
test("isAlive: signal 0 detecta vivo (self) e morto", async () => {
  const { isAlive } = await imp(supMod)
  assert.equal(isAlive(process.pid), true, "o próprio processo está vivo")
  assert.equal(isAlive(0), false, "pid 0 = sem pid")
  assert.equal(isAlive(2147483646, { kill: () => { throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }) } }), false)
})

// ── PRD14 §4.14: waitPidsExit espera a morte REAL (anti-EBUSY no Windows) ──
test("waitPidsExit: retorna vazio imediatamente quando nada está vivo", async () => {
  const { waitPidsExit } = await imp(supMod)
  const pending = await waitPidsExit([111, 222], { isAlive: () => false })
  assert.deepEqual(pending, [], "pids mortos não entram na espera")
  assert.deepEqual(await waitPidsExit([], {}), [], "lista vazia é no-op")
  assert.deepEqual(await waitPidsExit([0, null, undefined], {}), [], "pids falsy são ignorados")
})

test("waitPidsExit: espera até o pid morrer e retorna vazio", async () => {
  const { waitPidsExit } = await imp(supMod)
  let checks = 0
  const pending = await waitPidsExit([333], {
    isAlive: () => { checks++; return checks < 3 }, // morre na 3ª checagem
    sleep: async () => {},
  })
  assert.deepEqual(pending, [], "pid morreu dentro do timeout")
  assert.ok(checks >= 3, "poll re-checou até a morte")
})

test("waitPidsExit: timeout devolve os pids AINDA vivos (diagnóstico honesto)", async () => {
  const { waitPidsExit } = await imp(supMod)
  const pending = await waitPidsExit([444, 555], {
    isAlive: (p) => p === 555, // 444 morre já; 555 nunca morre
    timeoutMs: 50, intervalMs: 5,
  })
  assert.deepEqual(pending, [555], "só o pid preso volta como pendente")
})
