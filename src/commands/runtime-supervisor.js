import { spawn, execFileSync } from "child_process"
import { openSync, closeSync, mkdirSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { loadRuntimeManifest, validateRuntimeManifest } from "../runtime/manifest.js"
import {
  planStart, stopAll, pollReadiness, killTreeCommand,
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

/** `gstack_vibehard dev [--open] [--json]` — sobe os serviços do manifest. */
export async function devCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const m = loadRuntimeManifest(cwd)
  if (!m) { warn("Sem manifest de runtime — rode dentro de um projeto `gstack_vibehard create`."); return }
  const v = validateRuntimeManifest(m)
  if (!v.valid) { v.errors.forEach((e) => warn(`  ✗ ${e}`)); error("Runtime manifest inválido — corrija antes do `dev`."); return }

  clearState(cwd)
  mkdirSync(logsDir(cwd), { recursive: true })
  if (!json) section("dev — subindo o runtime")
  const plans = await planStart(m, { env: { ...process.env }, allocatePort: opts.allocatePort })
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
    child.unref()
    try { closeSync(fd) } catch { /* ok */ }
    const st = { name: p.name, pid: child.pid, port: p.port, status: "starting", log: logPath, startedAt: new Date().toISOString() }
    writeServiceState(cwd, p.name, st)
    started.push({ ...p, ...st })
    if (!json) info(`  ▸ ${p.name} (pid ${child.pid})${p.port ? ` :${p.port}` : ""} — ${[p.file, ...p.args].join(" ")}`)
  }

  // readiness por serviço (HTTP); marca ready/unhealthy honestamente
  for (const s of started) {
    if (!s.port || !s.readinessPath) { writeServiceState(cwd, s.name, { ...s, status: "running" }); continue }
    const url = `http://127.0.0.1:${s.port}${s.readinessPath}`
    const r = await pollReadiness(url, { httpGet, timeoutSeconds: s.readinessTimeout })
    s.status = r.ok ? "ready" : "unhealthy"
    s.url = url
    writeServiceState(cwd, s.name, { name: s.name, pid: s.pid, port: s.port, status: s.status, url, log: s.log })
    if (!json) (r.ok ? success : warn)(`  ${r.ok ? "✓" : "⚠"} ${s.name}: ${s.status}${r.ok ? ` (${url})` : " — veja os logs: gstack_vibehard logs " + s.name}`)
  }

  const web = started.find((s) => s.name === "web") || started.find((s) => s.url)
  if (json) { process.stdout.write(JSON.stringify({ services: readAllState(cwd) }) + "\n"); return }
  if (args.includes("--open") && web && web.url) { openUrl(web.url) && info(`  Preview aberto: ${web.url}`) }
  info("")
  info("  Logs: `gstack_vibehard logs <serviço>` · Parar: `gstack_vibehard stop`")
}

/** `gstack_vibehard stop` — encerra a árvore de processos. Idempotente. */
export function stopCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const state = readAllState(cwd)
  if (state.length === 0) { if (!json) info("Nada rodando (sem state de runtime)."); else process.stdout.write('{"stopped":[]}\n'); return }
  const results = stopAll(state, { exec: (file, a) => execFileSync(file, a, { stdio: "ignore" }) })
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
