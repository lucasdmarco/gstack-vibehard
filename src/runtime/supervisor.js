import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "fs"
import { join, resolve, relative, isAbsolute } from "path"
import { allocatePort } from "./ports.js"
import { stripBom } from "../util/json.js"
import { ensureRoutedChildEnv } from "../tools/headroom-policy.js"

/**
 * Supervisor de runtime (PRD 12 PR4): consome o Runtime Manifest V2 e sobe/derruba
 * os serviços. Lógica PURA e injetável (allocatePort/exec/kill/httpGet/sleep) — o
 * spawn real fica no comando. Spawn SEM shell (argv do manifest), port allocation
 * sem race, kill da ÁRVORE por plataforma, state em `.gstack/runtime/`.
 *
 * Endurecimento (v3.7.2): env por ALLOWLIST (nunca process.env inteiro), state file
 * por WHITELIST de campos (nunca env/segredo em disco), nome de serviço validado +
 * caminho contido no runtime dir (anti path-traversal), readiness só 2xx/3xx, e
 * validação de DONO do PID no stop (anti pid-reuse/state adulterado).
 */

export function runtimeDir(projectDir) { return join(projectDir, ".gstack", "runtime") }
export function logsDir(projectDir) { return join(runtimeDir(projectDir), "logs") }

/** Nome de serviço seguro: sem separador de path, sem `..`. Vira nome de arquivo. */
export function isValidServiceName(name) {
  return typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name) && !name.includes("..")
}

/** Garante que `target` está DENTRO de `baseDir` (anti path-traversal). Lança se não. */
export function assertWithin(baseDir, target) {
  const rel = relative(resolve(baseDir), resolve(target))
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`caminho fora do runtime dir: ${target}`)
  }
  return target
}

// Vars de ambiente OS-essenciais para um processo RODAR (node/pnpm). Tudo que NÃO
// está aqui (e não é segredo declarado em secretRefs) NUNCA chega ao serviço.
const SAFE_ENV_KEYS = Object.freeze([
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR",
  "ComSpec", "COMSPEC", "TEMP", "TMP", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL", "LC_CTYPE",
  "TZ", "NODE_PATH", "USER", "USERNAME", "LOGNAME", "SHELL",
])

/** Base de env SEGURA: só as chaves OS-essenciais presentes na fonte. */
export function safeBaseEnv(source = {}) {
  const out = {}
  for (const k of SAFE_ENV_KEYS) if (source[k] != null) out[k] = String(source[k])
  return out
}

/** Whitelist de campos do state file — env/segredo NUNCA são gravados em disco. */
const STATE_KEYS = Object.freeze(["name", "pid", "ppid", "port", "status", "url", "log", "startedAt", "command", "detail"])
export function pickState(obj = {}) {
  const out = {}
  for (const k of STATE_KEYS) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

/**
 * Resolve portas e constrói o plano de spawn (argv array + env SEGURO). O env do
 * processo = base OS-essencial + porta alocada + APENAS os segredos declarados em
 * `secretRefs` (lidos de `opts.envSource`). Nunca o process.env inteiro.
 */
const readinessPathOf = (s) => s.health && s.health.readiness && s.health.readiness.path
const readinessTimeoutOf = (s) => (s.health && s.health.readiness && s.health.readiness.timeoutSeconds) || 60
async function applyPort(s, env, allocate) {
  if (!s.port) return null
  const port = s.port.autoAllocate ? await allocate(s.port.preferred) : s.port.preferred
  if (s.port.env) env[s.port.env] = String(port)
  return port
}
// só os segredos DECLARADOS chegam ao processo (allowlist explícita)
function applySecrets(s, source, env) {
  for (const ref of s.secretRefs || []) {
    if (Object.prototype.hasOwnProperty.call(source, ref) && source[ref] != null) env[ref] = String(source[ref])
  }
}
function buildServicePlan(s, env, port) {
  return {
    name: s.name,
    file: s.command[0],
    args: s.command.slice(1),
    cwd: s.cwd || ".",
    env,
    port,
    command: [s.command[0], ...s.command.slice(1)].join(" "),
    readinessPath: readinessPathOf(s),
    readinessTimeout: readinessTimeoutOf(s),
  }
}
/**
 * Resolve o overlay de env ROTEADO pelo Headroom (PRD41 S41.8 / P1.4) — o chamador de
 * PRODUÇÃO de `ensureRoutedChildEnv`. Só roteia com `opts.routing.enabled` (Full+opt-in);
 * senão devolve null → env do child intocado. Nunca muta env global (só monta objetos).
 */
const routingArgs = (r) => ({
  cwd: r.cwd || process.cwd(), baseEnv: {}, mode: r.mode || "full",
  env: r.env || process.env, start: r.start, status: r.status,
  // P1.4: repassa o probe de tráfego injetável (default real: socket loopback). `routed` só
  // é afirmado após o probe — sem isso o dev roda sem routing (fail-safe).
  ...(r.probe ? { probe: r.probe } : {}),
})
async function resolveChildRoutingOverlay(opts) {
  const r = opts.routing
  if (!r || !r.enabled) return null
  const res = await ensureRoutedChildEnv(routingArgs(r))
  return res.routed ? res.env : null
}

async function planService(s, ctx) {
  const env = safeBaseEnv(ctx.source)
  const port = await applyPort(s, env, ctx.allocate)
  applySecrets(s, ctx.source, env)
  if (ctx.routingOverlay) Object.assign(env, ctx.routingOverlay)
  return buildServicePlan(s, env, port)
}

export async function planStart(manifest, opts = {}) {
  const ctx = {
    source: opts.envSource || opts.env || {},
    allocate: opts.allocatePort || ((p) => allocatePort(p)),
    routingOverlay: await resolveChildRoutingOverlay(opts),
  }
  const plans = []
  for (const s of manifest.services || []) plans.push(await planService(s, ctx))
  return plans
}

/**
 * Comando de KILL da ÁRVORE por plataforma (sem shell). { file, args }.
 *
 * DUAS FORMAS, e a distinção é o P0 §2.1 do PRD54 (S54.1). O §2.1 exige, em
 * ordem, "shutdown gracioso bounded" e "encerramento da árvore como FALLBACK",
 * e diz textualmente que `taskkill /T /F` isolado NÃO satisfaz o contrato. Era
 * exatamente o que o Windows tinha: uma única forma, forçada, imediata.
 *
 * `/F` é `TerminateProcess` — o processo morre sem rodar handler de saída, sem
 * fechar arquivo aberto, sem liberar porta ordenadamente. Funciona, e é por isso
 * que era tentador; o preço aparece depois, no `EBUSY` ao remover o diretório e
 * na porta que demora a voltar.
 *
 * O DEFAULT E O GRACIOSO, e nao por preferencia estetica: no POSIX o
 * comportamento antigo JA era `kill -TERM`, e default `force` mudaria o POSIX de
 * SIGTERM para SIGKILL em silencio -- tirando a gentileza de todo chamador
 * existente para consertar o Windows. Quem escala e o orquestrador, nunca o
 * default.
 *
 * O QUE A FORMA GRACIOSA GARANTE, e o que ela NÃO garante. No POSIX, SIGTERM ao
 * grupo é um pedido real: o processo tem handler e pode sair limpo.
 *
 * NO WINDOWS ELA NÃO EXISTE, e isto foi MEDIDO nesta máquina, não deduzido:
 *
 *   taskkill /PID 18276 /T
 *   ERRO: o processo com PID 18276 (processo filho de PID 22916) não pôde ser
 *   finalizado. Razão: A finalização deste processo só pode ser forçada
 *   (com a opção /F)
 *
 * O SO RECUSA o pedido para um processo `detached` com console oculto — que é
 * exatamente como o supervisor spawna serviço. Não é "o serviço não atendeu": é
 * o Windows dizendo que, para esta classe de processo, a forma gentil não se
 * aplica. Esperar o prazo gracioso nesse caso é cobrar 3s de todo `stop` por uma
 * cortesia que ninguém recebe — e foi o que a primeira versão deste código fez,
 * até a medição aparecer.
 *
 * Por isso `suportaGracioso` decide, e o §2.1 continua satisfeito na estrutura:
 * quem PODE ser pedido é pedido, com prazo; quem não pode vai direto à árvore
 * forçada, e o recibo diz qual dos dois aconteceu. O caminho gracioso REAL no
 * Windows exige Job Object ou canal cooperativo — o próprio §2.1 antecipa isso
 * ("Windows Job Object, helper supervisor proprietário ou mecanismo
 * equivalente"), e enquanto não existir, não é declarado.
 */
export function killTreeCommand(pid, platform = process.platform, { force = false } = {}) {
  const arvore = ["/PID", String(pid), "/T"]
  if (platform === "win32") return { file: "taskkill", args: force ? [...arvore, "/F"] : arvore }
  // POSIX: o supervisor spawna `detached` → pid é líder do grupo; mata o GRUPO.
  // SIGTERM pede; SIGKILL não pede — é a mesma escada, com os nomes do POSIX.
  return { file: "kill", args: [force ? "-KILL" : "-TERM", `-${pid}`] }
}

/** PID está vivo? (signal 0 não mata, só checa existência). */
export function isAlive(pid, opts = {}) {
  if (!pid) return false
  const kill = opts.kill || ((p, s) => process.kill(p, s))
  try { kill(pid, 0); return true } catch (e) { return e && e.code === "EPERM" }
}

/**
 * PRD45 S45.1 (P1.1) — veredito TIPADO de ownership do PID. Antes falhava ABERTO (matava)
 * sempre que o baseline não era verificável, o que permitia matar um PID reusado a partir de
 * um state adulterado. Agora distingue:
 *   • baseline ausente/inválido (`!startedAt` ou timestamp lixo) = adulteração óbvia ⇒
 *     `unverified_baseline`, NÃO-nosso (fail-closed: o stop pula, não mata);
 *   • idade ILEGÍVEL (`liveAgeSec == null`: permissão/SO) = ambiente, não ataque ⇒ procede
 *     matando, MAS auditado (`unverified_age`) — nunca silencioso (decisão de produto);
 *   • idade legível: compara com a esperada por `startedAt` (tz-free). Divergência > tol =
 *     pid reusado ⇒ `foreign`, não-nosso.
 * @returns {{ ours:boolean, verified:boolean, reason:string }}
 */
export function ownershipVerdict(svc, liveAgeSec, nowMs = Date.now(), tolSec = 10) {
  const recorded = svc && svc.startedAt ? Date.parse(svc.startedAt) : NaN
  if (Number.isNaN(recorded)) return { ours: false, verified: false, reason: "unverified_baseline" }
  if (liveAgeSec == null) return { ours: true, verified: false, reason: "unverified_age" }
  const expectedAgeSec = (nowMs - recorded) / 1000
  if (Math.abs(liveAgeSec - expectedAgeSec) <= tolSec) return { ours: true, verified: true, reason: "verified" }
  return { ours: false, verified: true, reason: "foreign" }
}

/**
 * Compat: contrato booleano preservado para chamadores existentes. `true` = pode prosseguir
 * (nosso OU idade ilegível-porém-auditada); `false` = não-nosso comprovado ou não-verificável.
 * O motivo detalhado (fail-closed vs auditado) vem de `ownershipVerdict`.
 */
export function isProcessOurs(svc, liveAgeSec, nowMs = Date.now(), tolSec = 10) {
  return ownershipVerdict(svc, liveAgeSec, nowMs, tolSec).ours
}

/**
 * Encerra todos os PIDs do state. Idempotente. `exec`/`kill`/`getAgeSec`/`platform`
 * injetáveis. POSIX: caminho NATIVO `process.kill(-pid, SIGTERM)` (mata o GRUPO via
 * syscall) — NÃO usa o binário `kill` (o `kill` do util-linux sai 0 sem matar com
 * `-<pid>`). Windows: `taskkill /T /F` via `exec`. Antes de matar, valida o DONO do
 * PID (se `getAgeSec` fornecido): pid reusado/foreign é PULADO, não morto.
 */
// POSIX: caminho NATIVO `process.kill(-pid, SIGTERM)` (mata o GRUPO via syscall).
// Windows: `taskkill /T /F` via `exec`.
function doKill(svc, exec, kill, platform, force = false) {
  if (exec) { const { file, args } = killTreeCommand(svc.pid, platform, { force }); exec(file, args); return }
  // Sem `exec` (caminho nativo POSIX): o sinal É a fase. No Windows o `kill` do
  // Node traduz tudo para `TerminateProcess`, então a fase graciosa não existe
  // por este caminho — quem quer as duas fases no Windows precisa do `exec`.
  kill(platform === "win32" ? svc.pid : -svc.pid, force ? "SIGKILL" : "SIGTERM")
}
const svcName = (svc) => svc && svc.name
// Erro de kill → status TIPADO (P0.2). ESRCH = já sumiu; EPERM/EACCES = acesso negado;
// resto = falha de sinal. NUNCA colapsa tudo em "already-gone" (que escondia o access_denied).
// LEGADO: mantido por compat; a autoridade real agora é `classifyKillResult` (probe).
function killErrorStatus(code) {
  if (code === "ESRCH") return "already_gone"
  if (code === "EPERM" || code === "EACCES") return "access_denied"
  return "signal_failed"
}

// PRD51 S51.1 (achado 4.1): o `taskkill` de PID morto NÃO lança com `code:"ESRCH"` —
// lança com `code:undefined`, `status:128`, `stderr:"...não foi encontrado"`. Classificar
// por `e.code` mandava isso para `signal_failed` e preservava o state para sempre.
const isAccessDeniedError = (e) =>
  Boolean(e) && (e.code === "EPERM" || e.code === "EACCES" || /acesso negado|access denied/i.test(String(e.stderr || "")))
const isNotFoundError = (e) =>
  Boolean(e) && (e.code === "ESRCH" || /não foi encontrad|not found|no such process/i.test(String(e.stderr || "")))

/**
 * Classifica o resultado de um kill pela PROBE DE LIVENESS real, não pelo exit
 * code do taskkill. A probe é a autoridade: se o processo sumiu, acabou —
 * custe o que o taskkill disser. `access_denied` só quando o processo continua
 * vivo E o erro foi de permissão. `signal_failed` só com erro desconhecido E
 * processo ainda vivo. `void isNotFoundError` mantém a intenção documentada.
 */
export function classifyKillResult({ error = null, aliveAfter } = {}) {
  void isNotFoundError
  if (aliveAfter === false) return error ? "already_gone" : "stopped"
  if (isAccessDeniedError(error)) return "access_denied"
  return error ? "signal_failed" : "still_alive"
}
// Decide o ownership ANTES de matar (P1.1). Sem getAgeSec, mantém o caminho legado (procede).
function ownershipFor(svc, ctx) {
  if (!ctx.getAgeSec) return { ours: true, verified: false, reason: "no_age_probe" }
  return ownershipVerdict(svc, ctx.getAgeSec(svc.pid), ctx.now || Date.now())
}
// Ownership não-nosso → status de "pulado" (fail-closed ou reusado). @returns row ou null.
function skipRow(svc, own) {
  if (own.ours) return null
  const status = own.reason === "unverified_baseline" ? "skipped_unverified" : "skipped_foreign"
  return { name: svc.name, status, pid: svc.pid }
}
function attemptKill(svc, ctx, own) {
  // PRD51 S51.1: tenta o kill, depois PROBE de liveness — a probe decide o status,
  // não o exit code do taskkill (que no Windows mente sobre PID morto).
  let error = null
  try { doKill(svc, ctx.exec, ctx.kill, ctx.platform, ctx.force) } catch (e) { error = e }
  const aliveAfter = ctx.isAlive(svc.pid)
  const status = classifyKillResult({ error, aliveAfter })
  const note = own.reason === "unverified_age" ? { note: "unverified_age" } : {}
  const detail = error ? { detail: error.message } : {}
  const fase = { phase: ctx.force ? "force" : "graceful" }
  return { name: svc.name, status, pid: svc.pid, ...fase, ...note, ...detail }
}
// Encerra UM serviço. Idempotente. Não-verificável (fail-closed) e reusado são PULADOS.
function stopService(svc, ctx) {
  if (!svc || !svc.pid) return { name: svcName(svc), status: "no_pid" }
  const own = ownershipFor(svc, ctx)
  return skipRow(svc, own) || attemptKill(svc, ctx, own)
}
export function stopAll(state, opts = {}) {
  const kill = opts.kill || ((pid, sig) => process.kill(pid, sig))
  const ctx = {
    exec: opts.exec,
    kill,
    // A FASE. `false` (default) pede; `true` força. Ver `killTreeCommand`.
    force: opts.force === true,
    // A probe de liveness (default: process.kill(pid,0)) é a autoridade do status.
    isAlive: opts.isAlive || ((pid) => isAlive(pid, { kill })),
    getAgeSec: opts.getAgeSec,
    now: opts.now,
    platform: opts.platform || process.platform,
  }
  return (state || []).map((svc) => stopService(svc, ctx))
}

// PRD45 S45.1 (P0.2) — só é seguro apagar o state quando NADA ficou pendente: nem pid vivo,
// nem acesso negado, nem sinal falho, nem pulado por não-verificação. Preservar o state é o
// que torna o retry idempotente possível — apagar cedo era o bug que impedia a 2ª tentativa.
// PRD51 S51.1: `still_alive` e `handle_not_released` são não-resolvidos — o
// state nunca pode ser limpo enquanto um deles existir (senão o retry perde o pid).
const STOP_UNRESOLVED = new Set(["access_denied", "signal_failed", "still_alive", "handle_not_released", "skipped_unverified", "skipped_foreign"])
// PRD51 S51.1.1 (P0b): SÓ o `still_alive` é a race pura — kill SEM erro, mas a probe
// IMEDIATA de `attemptKill` ainda vê o processo (taskkill /F é assíncrono no Windows).
// A AUTORIDADE final é a liveness pós-espera (`waitPidsExit`): se o pid morreu durante a
// espera, `still_alive` vira `stopped`. Deliberadamente NÃO reconciliamos:
//   • `access_denied`/`signal_failed` — anomalia de permissão/erro; fail-closed por decisão
//     do PRD45 S45.1 (P0.2): preservam o state mesmo que o pid morra sozinho depois;
//   • `skipped_*` (ownership) — decisão de não-tocar, não é liveness nossa.
const LIVENESS_DEPENDENT = new Set(["still_alive"])
// Reconcilia cada result contra a liveness real pós-espera. Um status liveness-dependent
// cujo pid sumiu vira `stopped` (mantendo `reconciledFrom` para diagnóstico honesto).
function reconcileByLiveness(results, aliveSet) {
  return (results || []).map((r) =>
    LIVENESS_DEPENDENT.has(r.status) && !aliveSet.has(r.pid)
      ? { ...r, status: "stopped", reconciledFrom: r.status }
      : r)
}
export function stopOutcome(results, stillAlive) {
  const aliveSet = new Set(stillAlive || [])
  const reconciled = reconcileByLiveness(results, aliveSet)
  const unresolved = reconciled.filter((r) => STOP_UNRESOLVED.has(r.status))
  const clearable = unresolved.length === 0 && aliveSet.size === 0
  return {
    clearable,
    exitCode: clearable ? 0 : 1,
    unresolved: unresolved.map((r) => ({ name: r.name, status: r.status, pid: r.pid })),
    stillAlive: stillAlive || [],
    results: reconciled,
  }
}

/**
 * Espera BOUNDED até os pids morrerem de verdade. `taskkill`/`kill` retornam antes
 * de o SO encerrar o processo e liberar seus handles (log fd, cwd) — no Windows,
 * remover o diretório do projeto logo após o stop dá EBUSY. Retorna os pids que
 * AINDA estão vivos após o timeout (vazio = todos mortos), para diagnóstico honesto.
 */
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitPidsExit(pids, { isAlive: alive = isAlive, timeoutMs = 5000, intervalMs = 100, sleep = sleepMs } = {}) {
  // isAlive já trata pid falsy (retorna false) — sem pré-filtro de truthiness.
  const deadline = Date.now() + timeoutMs
  let pending = (pids || []).filter((p) => alive(p))
  while (pending.length && Date.now() < deadline) {
    await sleep(intervalMs)
    pending = pending.filter((p) => alive(p))
  }
  return pending
}

// só 2xx/3xx = saudável. 4xx/5xx = NÃO pronto (404 na rota de health não é "de pé").
const isHealthy = (res) => res && res.status >= 200 && res.status < 400
async function probeReadiness(httpGet, url) {
  try { const res = await httpGet(url); return isHealthy(res) ? res.status : null } catch { return null }
}
function pollOpts(opts) {
  return {
    httpGet: opts.httpGet,
    timeoutMs: (opts.timeoutSeconds || 60) * 1000,
    intervalMs: opts.intervalMs || 500,
    sleep: opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: opts.now || (() => Date.now()),
  }
}
/** Poll de readiness HTTP. `httpGet(url)`→`{status}`|throw. 2xx/3xx = pronto. */
export async function pollReadiness(url, opts = {}) {
  const { httpGet, timeoutMs, intervalMs, sleep, now } = pollOpts(opts)
  const start = now()
  while (now() - start < timeoutMs) {
    const status = await probeReadiness(httpGet, url)
    if (status != null) return { ok: true, status }
    await sleep(intervalMs)
  }
  return { ok: false, status: null, timedOut: true }
}

/** State por serviço em `.gstack/runtime/<name>.json`. Nome validado + path contido + WHITELIST. */
export function writeServiceState(projectDir, name, obj) {
  if (!isValidServiceName(name)) throw new Error(`nome de serviço inválido (anti path-traversal): ${name}`)
  const dir = runtimeDir(projectDir)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.json`)
  assertWithin(dir, file)
  writeFileSync(file, JSON.stringify(pickState(obj), null, 2) + "\n")
}
export function readAllState(projectDir) {
  const dir = runtimeDir(projectDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(stripBom(readFileSync(join(dir, f), "utf-8"))) } catch { return null } })
    .filter(Boolean)
}
export function clearState(projectDir) {
  try { rmSync(runtimeDir(projectDir), { recursive: true, force: true }) } catch { /* ignore */ }
}

/**
 * ENCERRAMENTO EM DUAS FASES — o P0 §2.1 do PRD54 (S54.1).
 *
 * O §2.1 exige, nesta ordem, "shutdown gracioso bounded" e "encerramento da
 * árvore como FALLBACK", e diz textualmente que `taskkill /T /F` isolado não
 * satisfaz o contrato. O Windows tinha só a segunda metade, e imediata.
 *
 * A escada:
 *   1. PEDE (`taskkill /T` — POSIX: SIGTERM ao grupo) e espera, BOUNDED;
 *   2. quem sobreviveu ao prazo é FORÇADO (`/F` — POSIX: SIGKILL) e esperado de
 *      novo, também bounded;
 *   3. quem sobreviveu às duas volta como não-resolvido, com o pid, para o
 *      `stopOutcome` decidir — nunca "parado" por otimismo.
 *
 * `resolvedBy` sai em cada linha e é a MEDIÇÃO que o §2.1 pede: dizer "temos
 * shutdown gracioso" sem saber quantas vezes ele bastou é a mesma classe de
 * afirmação que o PRD52 passou um programa removendo. Um serviço de console sem
 * janela pode ignorar o WM_CLOSE, e nesse caso a fase graciosa é uma cortesia
 * que custou o prazo — o recibo mostra isso em vez de escondê-lo.
 *
 * A FASE FORÇADA SÓ VÊ QUEM CONTINUA VIVO. Reenviar kill para pid já morto
 * produziria `already_gone` espúrio e, pior, poderia atingir um PID REUSADO — o
 * ownership foi verificado na fase 1, e o intervalo entre as fases é justamente
 * quando um pid liberado pode ser reciclado pelo SO.
 */
export async function stopAllPhased(state, opts = {}) {
  const o = opcoesDaEscada(opts)
  const servicos = state || []
  if (!suportaGracioso(o.platform)) return await soForca(servicos, opts, o)

  const gracioso = stopAll(servicos, { ...opts, force: false })
  const escalados = await o.espera(pidsDe(gracioso), { timeoutMs: o.graceMs, isAlive: o.alive, sleep: opts.sleep })
  if (escalados.length === 0) return { results: marcar(gracioso, "graceful"), stillAlive: [], escalated: [] }

  // Só os que sobreviveram entram na fase forçada, e com o state ORIGINAL —
  // `stopAll` revalida ownership, então o pid reusado no intervalo é pulado.
  const teimosos = servicos.filter((s) => escalados.includes(s.pid))
  const forcado = stopAll(teimosos, { ...opts, force: true })
  const stillAlive = await o.espera(pidsDe(forcado), { timeoutMs: o.forceMs, isAlive: o.alive, sleep: opts.sleep })

  return { results: juntar(marcar(gracioso, "graceful"), marcar(forcado, "force"), escalados), stillAlive, escalated: escalados }
}

/**
 * A plataforma tem encerramento gracioso para o tipo de processo que o
 * supervisor spawna?
 *
 * POSIX sim: SIGTERM ao grupo é um pedido que o processo pode atender.
 * Windows não — medido, com a mensagem do SO citada em `killTreeCommand`.
 *
 * Enquanto for `false`, a fase graciosa é PULADA (não "tentada e falha"): tentar
 * gastaria o prazo inteiro para receber uma recusa conhecida. Quando existir Job
 * Object ou canal cooperativo, esta função passa a consultá-lo — e o resto da
 * escada não muda.
 */
export const suportaGracioso = (platform = process.platform) => platform !== "win32"

/** Sem fase graciosa: força direto, e o recibo NOMEIA por que não houve pedido. */
async function soForca(servicos, opts, o) {
  const forcado = stopAll(servicos, { ...opts, force: true })
  const stillAlive = await o.espera(pidsDe(forcado), { timeoutMs: o.forceMs, isAlive: o.alive, sleep: opts.sleep })
  return {
    results: forcado.map((r) => ({ ...r, resolvedBy: "force", gracefulSkipped: "unsupported_on_platform" })),
    stillAlive,
    escalated: [],
  }
}

/**
 * Os prazos e as injeções, num lugar só.
 *
 * 3s para PEDIR e 5s para FORÇAR: o prazo gracioso é curto de propósito — ele é
 * uma cortesia, e um serviço que não atende em 3s não vai atender em 30. O prazo
 * da força é o mesmo 5s que o `stop` já usava, porque `taskkill /F` retorna
 * antes de o SO liberar os handles (a razão do `EBUSY` histórico).
 */
const opcoesDaEscada = (opts) => ({
  graceMs: opts.gracePeriodMs ?? 3000,
  forceMs: opts.forceTimeoutMs ?? 5000,
  alive: opts.isAlive || ((pid) => isAlive(pid)),
  espera: opts.waitPidsExit || waitPidsExit,
  platform: opts.platform || process.platform,
})

const pidsDe = (rs) => rs.map((r) => r.pid)
const marcar = (rs, resolvedBy) => rs.map((r) => ({ ...r, resolvedBy }))

/**
 * O resultado da fase forçada SUBSTITUI o da graciosa, para os pids escalados.
 *
 * Manter os dois seria reportar o mesmo serviço duas vezes com status
 * diferentes, e o `stopOutcome` conta linhas — o serviço apareceria como
 * resolvido e pendente ao mesmo tempo.
 */
function juntar(gracioso, forcado, escalados) {
  const porPid = new Map(forcado.map((r) => [r.pid, r]))
  return gracioso.map((r) => (escalados.includes(r.pid) && porPid.has(r.pid) ? porPid.get(r.pid) : r))
}
