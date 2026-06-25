import { spawn, execFileSync } from "child_process"
import { openSync, closeSync, mkdirSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { loadRuntimeManifest, validateRuntimeManifest } from "../runtime/manifest.js"
import {
  planStart, stopAll, pollReadiness, killTreeCommand, isAlive,
  writeServiceState, readAllState, clearState, logsDir,
} from "../runtime/supervisor.js"
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

/** `gstack_vibehard dev [--open] [--force] [--json]` — sobe os serviços do manifest. */
export async function devCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const force = args.includes("--force")
  const m = loadRuntimeManifest(cwd)
  if (!m) { warn("Sem manifest de runtime — rode dentro de um projeto `gstack_vibehard create`."); return }
  const v = validateRuntimeManifest(m)
  if (!v.valid) { v.errors.forEach((e) => warn(`  ✗ ${e}`)); error("Runtime manifest inválido — corrija antes do `dev`."); return }

  // idempotência: se já há runtime VIVO, NÃO relança (senão perde o controle dos
  // processos antigos — vira órfão). Exige `stop` antes, ou `--force` para reiniciar.
  const alive = readAllState(cwd).filter((s) => s.pid && isAlive(s.pid))
  if (alive.length > 0 && !force) {
    warn(`Já há runtime ativo: ${alive.map((s) => `${s.name} (pid ${s.pid})`).join(", ")}.`)
    info("  Rode `gstack_vibehard stop` antes, ou `gstack_vibehard dev --force` para reiniciar.")
    return
  }
  if (alive.length > 0 && force) {
    const onWin = process.platform === "win32"
    const killed = stopAll(alive, onWin ? { exec: (f, a) => execFileSync(f, a, { stdio: "ignore" }) } : {})
    if (!json) killed.forEach((r) => info(`  • reiniciando — parei o antigo ${r.name}: ${r.status}`))
  }
  clearState(cwd)

  mkdirSync(logsDir(cwd), { recursive: true })
  if (!json) section("dev — subindo o runtime")
  // envSource = process.env, mas o plano só repassa ao serviço a base OS-essencial,
  // a porta alocada e os segredos DECLARADOS (secretRefs) — nunca o env inteiro.
  const plans = await planStart(m, { envSource: process.env, allocatePort: opts.allocatePort })
  const started = []
  for (const p of plans) {
    const logPath = join(logsDir(cwd), `${p.name}.log`)
    // fd numérico (não WriteStream — spawn exige fd/'pipe'/'inherit'). stdout+stderr
    // no mesmo log. Fecha o fd do pai após o spawn (o filho herdou o seu).
    const fd = openSync(logPath, "a")
    // detached em TODAS as plataformas: o filho precisa SOBREVIVER ao `dev` (que
    // sobe e sai). POSIX: vira líder de grupo → `kill -TERM -pid` mata a árvore.
    // Windows: roda independente do console do pai (windowsHide + stdio em arquivo
    // = sem janela); a árvore é morta por `taskkill /T /F`.
    const child = spawn(p.file, p.args, {
      cwd: join(cwd, p.cwd), env: p.env,
      stdio: ["ignore", fd, fd], shell: false,
      detached: true, windowsHide: true,
    })
    // espera DETERMINÍSTICA do desfecho: 'spawn' = subiu, 'error' = falhou. Sem isso
    // um binário inexistente vira Unhandled 'error' (async) e DERRUBA o CLI.
    const outcome = await new Promise((res) => {
      let done = false
      child.once("spawn", () => { if (!done) { done = true; res({ ok: true }) } })
      child.once("error", (err) => { if (!done) { done = true; res({ ok: false, err }) } })
    })
    child.unref()
    try { closeSync(fd) } catch { /* ok */ }

    if (!outcome.ok) {
      const detail = (outcome.err && (outcome.err.code || outcome.err.message)) || "spawn falhou"
      writeServiceState(cwd, p.name, { name: p.name, port: p.port, status: "failed", log: logPath, command: p.command, detail })
      if (!json) warn(`  ✗ ${p.name}: falhou ao iniciar — ${detail}`)
      continue
    }
    const startedAt = new Date().toISOString()
    writeServiceState(cwd, p.name, { name: p.name, pid: child.pid, port: p.port, status: "starting", log: logPath, command: p.command, startedAt })
    started.push({ name: p.name, pid: child.pid, port: p.port, log: logPath, command: p.command, startedAt, readinessPath: p.readinessPath, readinessTimeout: p.readinessTimeout })
    if (!json) info(`  ▸ ${p.name} (pid ${child.pid})${p.port ? ` :${p.port}` : ""} — ${p.command}`)
  }

  // readiness por serviço (HTTP); marca ready/unhealthy honestamente (2xx/3xx = pronto)
  for (const s of started) {
    if (!s.port || !s.readinessPath) {
      writeServiceState(cwd, s.name, { name: s.name, pid: s.pid, port: s.port, status: "running", log: s.log, command: s.command, startedAt: s.startedAt })
      continue
    }
    const url = `http://127.0.0.1:${s.port}${s.readinessPath}`
    const r = await pollReadiness(url, { httpGet, timeoutSeconds: s.readinessTimeout })
    const status = r.ok ? "ready" : "unhealthy"
    s.status = status; s.url = url
    writeServiceState(cwd, s.name, { name: s.name, pid: s.pid, port: s.port, status, url, log: s.log, command: s.command, startedAt: s.startedAt })
    if (!json) (r.ok ? success : warn)(`  ${r.ok ? "✓" : "⚠"} ${s.name}: ${status}${r.ok ? ` (${url})` : " — veja os logs: gstack_vibehard logs " + s.name}`)
  }

  const web = started.find((s) => s.name === "web") || started.find((s) => s.url)
  if (json) { process.stdout.write(JSON.stringify({ services: readAllState(cwd) }) + "\n"); return }
  if (args.includes("--open") && web && web.url) { openUrl(web.url) && info(`  Preview aberto: ${web.url}`) }
  info("")
  info("  Logs: `gstack_vibehard logs <serviço>` · Parar: `gstack_vibehard stop`")
}

/**
 * Idade real do processo em SEGUNDOS (tz-free) — para validar o DONO do PID antes
 * de matar. Windows: elapsed via Get-Process (subtração local, sem fuso). POSIX:
 * `ps -o etimes=`. Qualquer falha → null (stopAll procede, fallback honesto).
 */
function procAgeSec(pid) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return null
  try {
    if (process.platform === "win32") {
      const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        `try{[int]((Get-Date)-(Get-Process -Id ${id} -ErrorAction Stop).StartTime).TotalSeconds}catch{''}`],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
      const v = parseInt(String(out).trim(), 10)
      return Number.isFinite(v) ? v : null
    }
    const out = execFileSync("ps", ["-o", "etimes=", "-p", String(id)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
    const v = parseInt(String(out).trim(), 10)
    return Number.isFinite(v) ? v : null
  } catch { return null }
}

/** `gstack_vibehard stop` — encerra a árvore de processos. Idempotente. */
export function stopCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const state = readAllState(cwd)
  if (state.length === 0) { if (!json) info("Nada rodando (sem state de runtime)."); else process.stdout.write('{"stopped":[]}\n'); return }
  // Valida o DONO do PID (idade do processo vs registrada) antes de matar: pid
  // reusado / state adulterado é PULADO (skipped-foreign), não morto. Windows:
  // taskkill /T /F via exec; POSIX: caminho nativo (process.kill(-pid) = grupo).
  const onWin = process.platform === "win32"
  const results = stopAll(state, {
    getAgeSec: opts.getAgeSec || procAgeSec,
    ...(onWin ? { exec: (file, a) => execFileSync(file, a, { stdio: "ignore" }) } : {}),
  })
  clearState(cwd)
  if (json) { process.stdout.write(JSON.stringify({ stopped: results }) + "\n"); return }
  section("stop — encerrando o runtime")
  for (const r of results) info(`  • ${r.name}: ${r.status}${r.pid ? ` (pid ${r.pid})` : ""}`)
  success("Runtime parado.")
}

/** `gstack_vibehard logs [serviço] [--follow]`. */
export function logsCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const svc = args.find((a) => !a.startsWith("-"))
  const state = readAllState(cwd)
  const target = svc ? state.find((s) => s.name === svc) : state[0]
  if (!target || !target.log || !existsSync(target.log)) { warn(`Sem log para '${svc || "(primeiro serviço)"}'. Rode \`gstack_vibehard dev\` primeiro.`); return }
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
