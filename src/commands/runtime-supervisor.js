import { spawn, execFileSync } from "child_process"
import { openSync, closeSync, mkdirSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { loadRuntimeManifest, validateRuntimeManifest } from "../runtime/manifest.js"
import { classifyWorkspace } from "../runtime/workspace.js"
import {
  planStart, stopAll, stopOutcome, pollReadiness, killTreeCommand, isAlive, waitPidsExit,
  writeServiceState, readAllState, clearState, logsDir,
} from "../runtime/supervisor.js"
import { resolveSecrets } from "../secrets/broker.js"
import { section, success, warn, error, info } from "../cli/index.js"

/** GET HTTP simples com timeout (readiness). Usa o fetch global (Node >= 18). */
async function httpGet(url, timeoutMs = 3000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    return { status: res.status }
  } finally { clearTimeout(t) }
}

function openUrl(url) {
  try {
    if (process.platform === "win32") execFileSync("cmd.exe", ["/c", "start", "", url], { stdio: "ignore" })
    else if (process.platform === "darwin") execFileSync("open", [url], { stdio: "ignore" })
    else execFileSync("xdg-open", [url], { stdio: "ignore" })
    return true
  } catch { return false }
}

// Sem manifest: diagnóstico acionável pelo workspace classifier (PRD28 28.0) —
// explica O QUE o diretório é e a trilha GStack correta. NUNCA sugere npm cru
// (o bug real: usuário leigo instalou pacotes soltos no home p/ "consertar").
function explainNoManifest(cwd) {
  const ws = classifyWorkspace(cwd)
  warn(`Sem runtime executável aqui — ${ws.description}.`)
  if (ws.state === "node_app") {
    const scripts = ws.signals.scripts
    info(scripts.length ? `  Este app tem scripts próprios (${scripts.join(", ")}), mas não é um runtime GStack.` : "  Este package.json não tem script de dev.")
  }
  info("  O que fazer:")
  ws.actions.forEach((a) => info(`    • ${a}`))
}
function loadValidDevManifest(cwd) {
  const m = loadRuntimeManifest(cwd)
  if (!m) { explainNoManifest(cwd); return null }
  const v = validateRuntimeManifest(m)
  if (!v.valid) { v.errors.forEach((e) => warn(`  ✗ ${e}`)); error("Runtime manifest inválido — corrija antes do `dev`."); return null }
  return m
}
// Reinicia (--force): mata a árvore antiga e ESPERA a morte real (senão o antigo
// ainda segura a porta/log e o novo nasce unhealthy — race do taskkill).
async function restartAlive(alive, json) {
  const onWin = process.platform === "win32"
  const killed = stopAll(alive, onWin ? { exec: (f, a) => execFileSync(f, a, { stdio: "ignore" }) } : {})
  if (!json) killed.forEach((r) => info(`  • reiniciando — parei o antigo ${r.name}: ${r.status}`))
  // TODOS os pids (não só "stopped"): "already-gone" pode estar em teardown de handles.
  await waitPidsExit(killed.map((r) => r.pid))
}
// idempotência: se já há runtime VIVO, NÃO relança sem --force (senão órfã os
// antigos). Retorna false → o `dev` deve abortar.
async function ensureNotAlreadyRunning(cwd, force, json) {
  const alive = readAllState(cwd).filter((s) => s.pid && isAlive(s.pid))
  if (alive.length === 0) return true
  if (!force) {
    warn(`Já há runtime ativo: ${alive.map((s) => `${s.name} (pid ${s.pid})`).join(", ")}.`)
    info("  Rode `gstack_vibehard stop` antes, ou `gstack_vibehard dev --force` para reiniciar.")
    return false
  }
  await restartAlive(alive, json)
  return true
}
// Segredos DECLARADOS (secretRefs) do BROKER (keychain), em memória. Precedência
// sobre o env do shell. Sem broker → cai no env.
function resolveDevSecrets(m, cwd, opts) {
  const refNames = [...new Set((m.services || []).flatMap((s) => s.secretRefs || []))]
  return refNames.length ? resolveSecrets(cwd, refNames, opts) : {}
}

// fd numérico (não WriteStream — spawn exige fd/'pipe'/'inherit'); stdout+stderr no
// mesmo log. detached em TODAS as plataformas: o filho SOBREVIVE ao `dev`.
function spawnServiceChild(p, cwd, logPath) {
  const fd = openSync(logPath, "a")
  const child = spawn(p.file, p.args, { cwd: join(cwd, p.cwd), env: p.env, stdio: ["ignore", fd, fd], shell: false, detached: true, windowsHide: true })
  return { child, fd }
}
// espera DETERMINÍSTICA do desfecho: 'spawn'=subiu, 'error'=falhou (senão o 'error'
// async de um binário inexistente DERRUBA o CLI).
function awaitSpawn(child) {
  return new Promise((res) => {
    let done = false
    child.once("spawn", () => { if (!done) { done = true; res({ ok: true }) } })
    child.once("error", (err) => { if (!done) { done = true; res({ ok: false, err }) } })
  })
}
const spawnDetail = (err) => (err && (err.code || err.message)) || "spawn falhou"
function failService(cwd, p, logPath, json, detail) {
  writeServiceState(cwd, p.name, { name: p.name, port: p.port, status: "failed", log: logPath, command: p.command, detail })
  if (!json) warn(`  ✗ ${p.name}: falhou ao iniciar — ${detail}`)
  return null
}
async function startOneService(p, cwd, json) {
  const logPath = join(logsDir(cwd), `${p.name}.log`)
  const { child, fd } = spawnServiceChild(p, cwd, logPath)
  const outcome = await awaitSpawn(child)
  child.unref()
  try { closeSync(fd) } catch { /* ok */ }
  if (!outcome.ok) return failService(cwd, p, logPath, json, spawnDetail(outcome.err))
  const startedAt = new Date().toISOString()
  writeServiceState(cwd, p.name, { name: p.name, pid: child.pid, port: p.port, status: "starting", log: logPath, command: p.command, startedAt })
  if (!json) info(`  ▸ ${p.name} (pid ${child.pid})${p.port ? ` :${p.port}` : ""} — ${p.command}`)
  return { name: p.name, pid: child.pid, port: p.port, log: logPath, command: p.command, startedAt, readinessPath: p.readinessPath, readinessTimeout: p.readinessTimeout }
}
async function startAllServices(plans, cwd, json) {
  const started = []
  for (const p of plans) { const s = await startOneService(p, cwd, json); if (s) started.push(s) }
  return started
}

function reportReadiness(s, r, url, status) {
  const detail = r.ok ? ` (${url})` : " — veja os logs: gstack_vibehard logs " + s.name
  ;(r.ok ? success : warn)(`  ${r.ok ? "✓" : "⚠"} ${s.name}: ${status}${detail}`)
}
// readiness por serviço (HTTP): 2xx/3xx = pronto; marca ready/unhealthy honesto.
async function checkServiceReadiness(s, cwd, json) {
  if (!s.port || !s.readinessPath) {
    writeServiceState(cwd, s.name, { name: s.name, pid: s.pid, port: s.port, status: "running", log: s.log, command: s.command, startedAt: s.startedAt })
    return
  }
  const url = `http://127.0.0.1:${s.port}${s.readinessPath}`
  const r = await pollReadiness(url, { httpGet, timeoutSeconds: s.readinessTimeout })
  const status = r.ok ? "ready" : "unhealthy"
  s.status = status; s.url = url
  writeServiceState(cwd, s.name, { name: s.name, pid: s.pid, port: s.port, status, url, log: s.log, command: s.command, startedAt: s.startedAt })
  if (!json) reportReadiness(s, r, url, status)
}
async function checkAllReadiness(started, cwd, json) {
  for (const s of started) await checkServiceReadiness(s, cwd, json)
}
function openPreview(args, started) {
  const web = started.find((s) => s.name === "web") || started.find((s) => s.url)
  if (args.includes("--open") && web && web.url) openUrl(web.url) && info(`  Preview aberto: ${web.url}`)
  info("")
  info("  Logs: `gstack_vibehard logs <serviço>` · Parar: `gstack_vibehard stop`")
}

/** `gstack_vibehard dev [--open] [--force] [--json]` — sobe os serviços do manifest. */
export async function devCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const m = loadValidDevManifest(cwd)
  if (!m) return
  if (!(await ensureNotAlreadyRunning(cwd, args.includes("--force"), json))) return
  clearState(cwd)
  mkdirSync(logsDir(cwd), { recursive: true })
  if (!json) section("dev — subindo o runtime")
  const brokerSecrets = resolveDevSecrets(m, cwd, opts)
  // envSource = env do shell + segredos do broker (precedência). O plano só repassa
  // ao serviço a base OS-essencial, a porta e os secretRefs — nunca tudo.
  const plans = await planStart(m, { envSource: { ...process.env, ...brokerSecrets }, allocatePort: opts.allocatePort })
  const started = await startAllServices(plans, cwd, json)
  await checkAllReadiness(started, cwd, json)
  if (json) return process.stdout.write(JSON.stringify({ services: readAllState(cwd) }) + "\n")
  openPreview(args, started)
}

/**
 * Idade real do processo em SEGUNDOS (tz-free) — para validar o DONO do PID antes
 * de matar. Windows: elapsed via Get-Process (subtração local, sem fuso). POSIX:
 * `ps -o etimes=`. Qualquer falha → null (stopAll procede, fallback honesto).
 */
const finiteOrNull = (v) => (Number.isFinite(v) ? v : null)
// Windows: elapsed via Get-Process (subtração local, sem fuso).
function procAgeWin(id) {
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    `try{[int]((Get-Date)-(Get-Process -Id ${id} -ErrorAction Stop).StartTime).TotalSeconds}catch{''}`],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
  return finiteOrNull(parseInt(String(out).trim(), 10))
}
// POSIX: `ps -o etimes=`.
function procAgePosix(id) {
  const out = execFileSync("ps", ["-o", "etimes=", "-p", String(id)], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
  return finiteOrNull(parseInt(String(out).trim(), 10))
}
function procAgeSec(pid) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return null
  try { return process.platform === "win32" ? procAgeWin(id) : procAgePosix(id) }
  catch { return null }
}

function stopNothing(json) {
  if (!json) info("Nada rodando (sem state de runtime).")
  else process.stdout.write('{"stopped":[]}\n')
}
// Valida o DONO do PID (idade vs registrada) antes de matar: pid reusado/adulterado
// é PULADO. Windows: taskkill /T /F via exec; POSIX: nativo (process.kill(-pid)).
function stopExecOpts(opts) {
  const onWin = process.platform === "win32"
  return { getAgeSec: opts.getAgeSec || procAgeSec, ...(onWin ? { exec: (file, a) => execFileSync(file, a, { stdio: "ignore" }) } : {}) }
}
const stopLine = (r) => `  • ${r.name}: ${r.status}${r.pid ? ` (pid ${r.pid})` : ""}${r.note ? ` [${r.note}]` : ""}`
function renderStopUnresolved(outcome) {
  // P0.2: state PRESERVADO — o retry (`stop` de novo) é seguro e idempotente.
  warn(`  ⚠ não encerrado(s): ${outcome.unresolved.map((u) => `${u.name}:${u.status}`).join(", ")}`)
  warn("  state PRESERVADO para retry — rode `stop` de novo (ou investigue o pid).")
}
function renderStop(results, outcome, opts) {
  section("stop — encerrando o runtime")
  for (const r of results) info(stopLine(r))
  if (outcome.stillAlive.length) warn(`  ⚠ pid(s) ainda finalizando após ${opts.waitTimeoutMs || 5000}ms: ${outcome.stillAlive.join(", ")}`)
  if (outcome.unresolved.length) renderStopUnresolved(outcome)
  else if (outcome.clearable) success("Runtime parado.")
}
/** `gstack_vibehard stop` — encerra a árvore de processos. Idempotente. @returns exitCode. */
export async function stopCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const state = readAllState(cwd)
  if (state.length === 0) return stopNothing(json)
  const results = stopAll(state, stopExecOpts(opts))
  // `stop` só reporta "parado" quando os processos MORRERAM de verdade (senão remover
  // o dir do projeto logo após dá EBUSY no Windows — PRD14 §4.14). Espera TODOS os
  // pids do state, não só status "stopped": um "already_gone" pode ainda estar em
  // teardown de handles (cwd/log) — isAlive filtra os já mortos de graça.
  const stillAlive = await waitPidsExit(results.map((r) => r.pid), { timeoutMs: opts.waitTimeoutMs || 5000 })
  // P0.2: só limpa o state quando NADA ficou pendente (vivo/negado/não-verificado). Apagar
  // com pid vivo era o bug que impedia a 2ª tentativa e deixava órfão/porta/handle presos.
  const outcome = stopOutcome(results, stillAlive)
  if (outcome.clearable) clearState(cwd)
  if (json) process.stdout.write(JSON.stringify({ stopped: results, stillAlive, cleared: outcome.clearable, exitCode: outcome.exitCode }) + "\n")
  else renderStop(results, outcome, opts)
  return outcome.exitCode
}

const noLogFile = (t) => !t || !t.log || !existsSync(t.log)
/** `gstack_vibehard logs [serviço] [--follow]`. */
export function logsCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const svc = args.find((a) => !a.startsWith("-"))
  const state = readAllState(cwd)
  const target = svc ? state.find((s) => s.name === svc) : state[0]
  if (noLogFile(target)) return warn(`Sem log para '${svc || "(primeiro serviço)"}'. Rode \`gstack_vibehard dev\` primeiro.`)
  section(`logs — ${target.name}`)
  process.stdout.write(readFileSync(target.log, "utf-8"))
  if (args.includes("--follow")) info("\n  (--follow contínuo chega no refinamento; por ora mostra o acumulado.)")
}

/** `gstack_vibehard open` — abre o preview do serviço web. */
export function openCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const state = readAllState(cwd)
  const web = state.find((s) => s.name === "web" && s.url) || state.find((s) => s.url)
  if (!web || !web.url) { warn("Sem preview ativo — rode `gstack_vibehard dev` primeiro."); return }
  openUrl(web.url) ? success(`Aberto: ${web.url}`) : warn(`Não consegui abrir o navegador. URL: ${web.url}`)
}

export { killTreeCommand }
