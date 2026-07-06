import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { readAllState, isAlive, waitPidsExit } from "../src/runtime/supervisor.js"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "runtime-supervisor.js")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** rm recursivo com retry/backoff próprio; retorna o último erro (null = sucesso). */
async function rmWithBackoff(dir, attempts = 8) {
  let lastErr = null
  for (let i = 0; i < attempts; i++) {
    try { await rm(dir, { recursive: true, force: true, maxRetries: 3 }); return null }
    catch (e) { lastErr = e; await sleep(200 * (i + 1)) }
  }
  return lastErr
}

/**
 * Espera DETERMINÍSTICA de liberação de handle (Windows): rename só funciona
 * quando nenhum processo segura o arquivo — probe muito mais confiável que sleep
 * cego. Após o taskkill/exit, o SO (ou antivírus) pode reter o handle do log do
 * filho por um instante; aqui esperamos a liberação REAL, com orçamento limitado.
 */
async function waitLogsReleased(dir, budgetMs = 6000) {
  const logsDir = path.join(dir, ".gstack", "runtime", "logs")
  const files = await readdir(logsDir).catch(() => [])
  const deadline = Date.now() + budgetMs
  for (const name of files) {
    const file = path.join(logsDir, name)
    const probe = `${file}.probe`
    for (;;) {
      try { await rename(file, probe); await rename(probe, file); break } // liberado
      catch (e) {
        if (e.code === "ENOENT") break // já removido/renomeado — nada a esperar
        if (Date.now() > deadline) break // orçamento estourou — o rm diagnostica
        await sleep(150)
      }
    }
  }
}

/**
 * Cleanup à prova de EBUSY (Windows): para o runtime, espera os pids morrerem DE
 * VERDADE (taskkill retorna antes de o SO soltar os handles do filho), espera os
 * handles de LOG serem liberados (probe de rename, determinístico) e só então
 * remove o diretório com retry/backoff. Na última falha, diagnostica o que sobrou.
 * NADA disso enfraquece as asserções — o teste continua exigindo pids mortos e
 * remoção sem EBUSY; só a espera virou baseada em estado real, não em sorte.
 */
async function cleanupProject(dir, stopCommand) {
  try { await stopCommand([], { cwd: dir }) } catch { /* idempotente */ }
  // cinto e suspensório: qualquer pid remanescente no state (stop pode ter pulado)
  try {
    await waitPidsExit(readAllState(dir).map((s) => s.pid).filter((p) => p && isAlive(p)), { timeoutMs: 5000 })
  } catch { /* state ausente/ilegível = nada vivo a esperar */ }
  await waitLogsReleased(dir)
  const lastErr = await rmWithBackoff(dir)
  if (!lastErr) return
  // Diagnóstico do arquivo preso — sem isso o CI só mostra "EBUSY: <dir>".
  const leftover = await readdir(path.join(dir, ".gstack", "runtime", "logs")).catch(() => [])
  throw new Error(`cleanup falhou (${lastErr.code}): ${lastErr.path} — logs presos: ${leftover.join(", ") || "(nenhum listável)"}`)
}

// Servidor http mínimo: prova que o supervisor sobe um processo REAL, sem shell,
// que SOBREVIVE ao `dev` (detached) e é morto pelo `stop` (árvore por plataforma).
const SERVER = `import http from "http"
const port = process.env.E2E_PORT || 6010
http.createServer((req, res) => { res.writeHead(200); res.end("ok") }).listen(port, "127.0.0.1", () => console.log("up " + port))
`

async function tryFetch(url, ms = 1500) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { const r = await fetch(url, { signal: ctrl.signal }); return r.status } catch { return null } finally { clearTimeout(t) }
}

// Polling helpers: sobe (retorna status 2xx) / cai (porta liberada após stop).
async function waitForUp(url, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const status = await tryFetch(url)
    if (status !== null) return status
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}
async function waitForDown(url, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if ((await tryFetch(url, 800)) === null) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

test("e2e: dev sobe um serviço real (sobrevive ao launcher) e stop o mata", async () => {
  const { devCommand, stopCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-e2e-"))
  const port = 6010 + Math.floor(Math.random() * 500)
  try {
    await writeFile(path.join(dir, "server.mjs"), SERVER)
    await mkdir(path.join(dir, ".gstack"), { recursive: true })
    await writeFile(path.join(dir, ".gstack", "runtime.json"), JSON.stringify({
      schemaVersion: 2,
      services: [{
        name: "web",
        command: ["node", "server.mjs"],
        cwd: ".",
        port: { preferred: port, env: "E2E_PORT", autoAllocate: true },
        health: { readiness: { type: "http", path: "/", timeoutSeconds: 15 } },
      }],
    }, null, 2))

    await devCommand(["--json"], { cwd: dir })

    // a porta é ALOCADA pelo supervisor (preferred pode estar ocupada no CI) — leio
    // a porta/status REAIS do state file, nunca assumo a preferred.
    const state = JSON.parse(await readFile(path.join(dir, ".gstack", "runtime", "web.json"), "utf-8"))
    assert.equal(state.status, "ready", `dev marcou o serviço ready (status=${state.status})`)
    const realPort = state.port
    assert.ok(realPort >= port, "porta alocada a partir da preferred")

    // o serviço deve continuar de pé DEPOIS do dev retornar (prova do detached)
    const status = await waitForUp(`http://127.0.0.1:${realPort}/`)
    assert.equal(status, 200, "serviço respondendo após o dev sair (sobreviveu ao launcher)")

    await stopCommand([], { cwd: dir })

    // após o stop a porta deve cair
    const down = await waitForDown(`http://127.0.0.1:${realPort}/`)
    assert.equal(down, true, "porta liberada após o stop (árvore morta)")
  } finally {
    await cleanupProject(dir, stopCommand)
  }
})

async function mkProject(services) {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-e2e-"))
  await writeFile(path.join(dir, "server.mjs"), SERVER)
  await mkdir(path.join(dir, ".gstack"), { recursive: true })
  await writeFile(path.join(dir, ".gstack", "runtime.json"), JSON.stringify({ schemaVersion: 2, services }, null, 2))
  return dir
}

// ── ABUSO fix3: spawn de binário inexistente NÃO derruba o CLI; marca failed ──
test("e2e: spawn de binário inexistente não derruba o CLI (status failed)", async () => {
  const { devCommand, stopCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const dir = await mkProject([{
    name: "web", command: ["binario-que-nao-existe-zzz"], cwd: ".",
    port: { preferred: 7301, env: "E2E_PORT", autoAllocate: true },
    health: { readiness: { type: "http", path: "/", timeoutSeconds: 3 } },
  }])
  try {
    // se derrubasse o CLI, isto lançaria (Unhandled 'error') e o teste falharia
    await devCommand(["--json"], { cwd: dir })
    const state = JSON.parse(await readFile(path.join(dir, ".gstack", "runtime", "web.json"), "utf-8"))
    assert.equal(state.status, "failed", "spawn falho vira status failed (sem crash)")
    assert.ok(!state.pid, "serviço falho não tem pid running")
  } finally {
    await cleanupProject(dir, stopCommand)
  }
})

// ── ABUSO fix4: dev duas vezes — a 2ª RECUSA (idempotente), não duplica/orfana ──
test("e2e: dev duplicado recusa e mantém o mesmo pid (não orfana processos)", async () => {
  const { devCommand, stopCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const port = 7400 + Math.floor(Math.random() * 300)
  const dir = await mkProject([{
    name: "web", command: ["node", "server.mjs"], cwd: ".",
    port: { preferred: port, env: "E2E_PORT", autoAllocate: true },
    health: { readiness: { type: "http", path: "/", timeoutSeconds: 15 } },
  }])
  try {
    await devCommand(["--json"], { cwd: dir })
    const pid1 = JSON.parse(await readFile(path.join(dir, ".gstack", "runtime", "web.json"), "utf-8")).pid
    assert.ok(pid1, "primeiro dev subiu")

    await devCommand(["--json"], { cwd: dir }) // 2ª chamada SEM --force → deve recusar
    const pid2 = JSON.parse(await readFile(path.join(dir, ".gstack", "runtime", "web.json"), "utf-8")).pid
    assert.equal(pid2, pid1, "2ª chamada não relançou — mesmo pid, sem órfão")
  } finally {
    await cleanupProject(dir, stopCommand)
  }
})
