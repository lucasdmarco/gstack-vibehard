import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, rename } from "node:fs/promises"
import { existsSync } from "node:fs"
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
 * Espera DETERMINÍSTICA de liberação do DIRETÓRIO inteiro (Windows): renomear um
 * diretório falha enquanto QUALQUER handle estiver aberto em qualquer ponto da
 * árvore — inclusive o CWD de um filho/neto ainda em teardown, que probe por
 * ARQUIVO de log não detecta (evidência da revisão: rm falhou na raiz do temp com
 * "logs presos: nenhum listável"). Quando o rename do próprio dir funciona, o rm
 * funciona. Orçamento limitado; na falha, o rm diagnostica.
 */
async function waitDirRenameable(dir, budgetMs = 8000) {
  const probe = `${dir}.probe`
  const deadline = Date.now() + budgetMs
  for (;;) {
    try { await rename(dir, probe); await rename(probe, dir); return true }
    catch (e) {
      if (e.code === "ENOENT") return true // já removido — nada a esperar
      if (Date.now() > deadline) return false
      await sleep(150)
    }
  }
}

/**
 * Cleanup à prova de EBUSY (Windows), em 4 passos determinísticos:
 *  1. captura os PIDs ANTES do stop — o stop limpa o state; ler depois esperava
 *     em lista VAZIA (bug pego na revisão pós-v3.74);
 *  2. stop + waitPidsExit nos pids capturados (taskkill retorna antes do teardown);
 *  3. espera o DIRETÓRIO inteiro ficar renomeável (detecta handle de cwd/AV que
 *     probe por arquivo não vê);
 *  4. rm com retry/backoff. Na falha, diagnostica pids vivos + sobras.
 * NADA disso enfraquece as asserções — pids mortos e remoção sem EBUSY continuam
 * exigidos; só a espera é baseada em estado real, não em sorte.
 */
async function cleanupProject(dir, stopCommand) {
  let pids = []
  try { pids = readAllState(dir).map((s) => s.pid).filter(Boolean) } catch { /* sem state */ }
  try { await stopCommand([], { cwd: dir }) } catch { /* idempotente */ }
  const stillAlive = await waitPidsExit(pids, { timeoutMs: 8000 }).catch(() => [])
  await waitDirRenameable(dir)
  const lastErr = await rmWithBackoff(dir)
  if (!lastErr) return
  // Diagnóstico completo — sem isso o CI só mostra "EBUSY: <dir>".
  const leftover = await readdir(path.join(dir, ".gstack", "runtime", "logs")).catch(() => [])
  const alive = pids.filter((p) => isAlive(p))
  throw new Error(
    `cleanup falhou (${lastErr.code}): ${lastErr.path} — pids capturados: [${pids.join(", ")}]` +
    ` · vivos pós-wait: [${stillAlive.join(", ")}] · vivos agora: [${alive.join(", ")}]` +
    ` · logs presos: ${leftover.join(", ") || "(nenhum listável)"}`,
  )
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

// ── ABUSO fix3: spawn falho NÃO derruba o CLI; marca failed ──
// O binário é um RUNNER allow (npm) com subcomando inexistente — assim o spawn de fato
// acontece e falha (o caso que este teste protege). Um binário DESCONHECIDO agora é barrado
// ANTES pelo gate P1.2 (coberto no teste logo abaixo), não chega ao spawn.
test("e2e: spawn falho (runner com subcomando inexistente) não derruba o CLI (status failed)", async () => {
  const { devCommand, stopCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const dir = await mkProject([{
    name: "web", command: ["npm", "run", "subcomando-que-nao-existe-zzz"], cwd: ".",
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

// ── PRD45 S45.2 (P1.2): manifest hostil de repo clonado é BLOQUEADO antes de qualquer spawn ──
test("e2e: dev RECUSA manifest com código inline (node -e) — nada é executado", async () => {
  const { devCommand, stopCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const dir = await mkProject([{
    name: "evil", command: ["node", "-e", "require('fs').writeFileSync('PWNED.txt','x')"], cwd: ".",
    port: { preferred: 7302, env: "E2E_PORT", autoAllocate: true },
    health: { readiness: { type: "http", path: "/", timeoutSeconds: 3 } },
  }])
  try {
    await devCommand(["--json"], { cwd: dir })
    // CONTROLE NEGATIVO: o efeito colateral do código inline NÃO aconteceu.
    assert.equal(existsSync(path.join(dir, "PWNED.txt")), false, "node -e foi BLOQUEADO antes do spawn")
    assert.equal(existsSync(path.join(dir, ".gstack", "runtime", "evil.json")), false, "nenhum serviço iniciado")
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
