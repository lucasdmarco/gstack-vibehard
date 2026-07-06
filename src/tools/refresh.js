import { mkdirSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { buildReadiness } from "./readiness.js"

/**
 * Action Close Tool Refresh (PRD24 Sprint 24.3): ao FECHAR uma ação da IA, mantém
 * contexto e ferramentas frescos — SEM tocar config global, SEM ligar proxy/wrap,
 * SEM registrar MCP global. Cada etapa é bounded/degraded: falha vira `degraded`
 * (não trava o usuário comum); em `--strict` uma etapa bloqueante falha vira `error`.
 * PURO/injetável (`runners`/`now`) → testável sem spawnar graphify/fallow/headroom.
 *
 * tmux NUNCA entra aqui: o refresh é batch (sem PTY). Runners default são
 * cross-platform (execFileSync bounded), nunca dependem de tmux.
 */

const INDEXER = join(dirname(fileURLToPath(import.meta.url)), "..", "context-docs", "py", "context_db.py")
const npxBin = () => (process.platform === "win32" ? "npx.cmd" : "npx")
const pyBin = () => (process.platform === "win32" ? "python" : "python3")
const RELEVANT = /\.(js|ts|jsx|tsx|mjs|cjs|py)$/i
const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-")
const trunc = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 300)

// DEP0190: shell:true com array de args é deprecado — para shims .cmd/.bat a
// string de comando é montada EXPLICITAMENTE com quoting (args são literais fixos).
const quoteArg = (a) => (/[\s"]/.test(String(a)) ? `"${String(a).replace(/"/g, '""')}"` : String(a))
const shellCommand = (file, args) => [quoteArg(file), ...(args || []).map(quoteArg)].join(" ")
function boundedRun(file, args, opts = {}) {
  const shell = /\.(cmd|bat)$/i.test(file)
  const common = { stdio: ["ignore", "pipe", "pipe"], timeout: opts.timeout || 90000, encoding: "utf-8", cwd: opts.cwd }
  try {
    const stdout = shell
      ? execFileSync(shellCommand(file, args), { ...common, shell: true })
      : execFileSync(file, args, common)
    return { ok: true, code: 0, summary: trunc(stdout), raw: stdout }
  } catch (e) {
    return { ok: false, code: typeof e.status === "number" ? e.status : null, summary: trunc(e.stderr || e.message), raw: "" }
  }
}

function headroomExe(cwd) {
  const rel = process.platform === "win32" ? ["Scripts", "headroom.exe"] : ["bin", "headroom"]
  return join(cwd, ".gstack", "tools", "headroom-venv", ...rel)
}
function gitChanged(cwd) {
  const r = boundedRun("git", ["diff", "--name-only", "HEAD"], { cwd, timeout: 10000 })
  return r.ok ? r.summary.split(/\s+/).filter(Boolean) : []
}

// Runners default: bounded, cross-platform, best-effort (nunca lançam).
export function defaultRunners(cwd) {
  const dbPath = join(cwd, ".gstack", "context", "context.db")
  return {
    changedFiles: () => gitChanged(cwd),
    graphify: () => boundedRun("graphify", ["update", "."], { cwd, timeout: 120000 }),
    contextIndex: () => boundedRun(pyBin(), [INDEXER, "index", "--db", dbPath, "--root", cwd, "--reindex"], { cwd, timeout: 120000 }),
    // Headroom SÓ classifica routing (doctor) — nunca proxy/wrap/MCP global.
    headroomDoctor: () => boundedRun(headroomExe(cwd), ["doctor"], { cwd, timeout: 15000 }),
    fallowAudit: () => boundedRun(npxBin(), ["fallow", "audit", "--format", "json"], { cwd, timeout: 90000 }),
    verify: () => boundedRun("node", [join(cwd, "src", "index.js"), "verify", "--changed-files", "--json"], { cwd, timeout: 120000 }),
  }
}

const relevantChanged = (files) => files.some((f) => RELEVANT.test(f))
const stepStatus = (ok, strict, blocking) => (ok ? "ok" : strict && blocking ? "error" : "degraded")
const errRes = (e) => ({ ok: false, code: null, summary: String(e && e.message || e), raw: "" })

// Executa uma etapa com timing + status; nunca lança.
function runStep(tool, fn, opts = {}) {
  const tick = opts.now || (() => Date.now())
  const t0 = tick()
  let res
  try { res = fn() } catch (e) { res = errRes(e) }
  return { tool, status: stepStatus(res.ok, opts.strict, opts.blocking), exitCode: res.code, durationMs: tick() - t0, summary: res.summary || "", raw: res.raw || "" }
}

// Graphify só roda quando NÃO for --changed, ou quando há arquivo relevante mudado.
function graphifyStep(runners, changed, opts) {
  if (changed && !relevantChanged(runners.changedFiles())) {
    return { tool: "graphify", status: "skipped", exitCode: null, durationMs: 0, summary: "nenhum arquivo relevante mudou", raw: "" }
  }
  return runStep("graphify", runners.graphify, opts)
}

function refreshSteps(runners, opts) {
  const steps = [
    graphifyStep(runners, opts.changed, opts),
    runStep("context", runners.contextIndex, { ...opts, blocking: true }),
    runStep("headroom", runners.headroomDoctor, opts),
    runStep("fallow", runners.fallowAudit, { ...opts, blocking: true }),
  ]
  if (opts.strict) steps.push(runStep("verify", runners.verify, { ...opts, blocking: true }))
  return steps
}

function writeRefreshReport(cwd, runId, report) {
  const dir = join(cwd, ".gstack", "reports", "tool-refresh")
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${runId}.json`)
  writeFileSync(p, JSON.stringify(report, null, 2) + "\n")
  return p
}

// Atualiza .gstack/tool-readiness.json com o AUDIT FRESCO do refresh (fecha 24.2↔24.3).
function refreshReadiness(cwd, fallowRaw) {
  const fallowAudit = () => ({ ok: !!fallowRaw, stdout: fallowRaw })
  const dir = join(cwd, ".gstack")
  mkdirSync(dir, { recursive: true })
  const p = join(dir, "tool-readiness.json")
  writeFileSync(p, JSON.stringify(buildReadiness({ cwd, fallowAudit }), null, 2) + "\n")
  return p
}

// Extrai o stdout completo do audit Fallow (p/ o readiness) e o remove dos steps.
function extractFallowRaw(steps) {
  const fallowStep = steps.find((s) => s.tool === "fallow")
  const raw = fallowStep ? fallowStep.raw : ""
  for (const s of steps) delete s.raw
  return raw
}
function refreshReport(runId, cwd, strict, changed, steps, nowIso) {
  return { runId, cwd, strict, changed, generatedAt: nowIso(), steps, ok: steps.every((s) => s.status !== "error") }
}

/**
 * Executa o refresh. `runners`/`now` injetáveis; `write:false` para não tocar disco.
 * @returns {{ runId, ok, strict, changed, steps, writtenTo, readinessPath }}
 */
export function buildToolRefresh(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const runId = opts.runId || `refresh-${nowStamp()}`
  const runners = { ...defaultRunners(cwd), ...(opts.runners || {}) }
  const steps = refreshSteps(runners, { strict: opts.strict === true, changed: opts.changed === true, now: opts.now })
  const fallowRaw = extractFallowRaw(steps)
  const report = refreshReport(runId, cwd, opts.strict === true, opts.changed === true, steps, opts.nowIso || (() => new Date().toISOString()))
  if (opts.write === false) return { ...report, writtenTo: null, readinessPath: null }
  return { ...report, writtenTo: writeRefreshReport(cwd, runId, report), readinessPath: refreshReadiness(cwd, fallowRaw) }
}
