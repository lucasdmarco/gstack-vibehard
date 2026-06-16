import { execFileSync as defaultExecFileSync } from "child_process"

/**
 * Delegação para OpenCode — usa OUTRO modelo/free tier configurado pelo USUÁRIO.
 *
 * Fase 1: policy declarativa (contrato). Fase 2 adiciona o runner real
 * `runDelegation`. O gstack NÃO faz model calls — quem chama o modelo é o
 * OpenCode (configurado pelo usuário). Tudo opt-in, com confirmação.
 */

// A task vai como arg em array (execFileSync, shell:false) → injecao de shell
// nao e possivel. Espacos sao OK (linguagem natural); rejeitamos newline/null.
const UNSAFE_TASK = /[\n\r\0]/

export function buildDelegationPolicy(overrides = {}) {
  return {
    enabled: false,
    requiresUserApproval: true,
    defaultHarness: "opencode",
    returnFormat: "summary+diff+exitCode+verifier",
    modelProvider: "user-configured",
    ...overrides,
  }
}

/** Valida a policy de delegação. Não lança. */
export function validateDelegation(policy) {
  const errors = []
  if (!policy || typeof policy !== "object") return { valid: false, errors: ["policy ausente"] }
  if (typeof policy.enabled !== "boolean") errors.push("enabled deve ser boolean")
  if (policy.enabled && policy.requiresUserApproval !== true) {
    errors.push("delegacao habilitada exige requiresUserApproval:true")
  }
  if (policy.defaultHarness && policy.defaultHarness !== "opencode") {
    errors.push("defaultHarness suportado: opencode")
  }
  return { valid: errors.length === 0, errors }
}

/** True se o CLI do OpenCode está disponível. */
export function isOpencodeAvailable(exec = defaultExecFileSync) {
  try {
    exec("opencode", ["--version"], { stdio: "pipe", timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export function isSafeTask(task) {
  return typeof task === "string" && task.trim().length > 0 && !UNSAFE_TASK.test(task)
}

/**
 * Runner real de delegação ao OpenCode (Fase 2).
 *
 * O gstack NÃO chama modelo — delega ao `opencode run` (modelo configurado pelo
 * usuário). Captura stdout/stderr e arquivos alterados (via git status), e
 * retorna um resumo ESTRUTURADO (nunca o transcript completo por default).
 *
 * @param {object} p { task, cwd, model?, timeout?, exec?, gitStatus? }
 * @returns {{ status, exitCode, summary, changedFiles, stderrTail? }}
 */
export function runDelegation(p = {}) {
  const exec = p.exec || defaultExecFileSync
  const cwd = p.cwd || process.cwd()
  if (!isSafeTask(p.task)) {
    return { status: "invalid_task", exitCode: null, summary: "task inválida (vazia ou com newline)", changedFiles: [] }
  }
  if (!isOpencodeAvailable(exec)) {
    return { status: "opencode_missing", exitCode: null, summary: "OpenCode CLI não encontrado (instale: npm i -g opencode)", changedFiles: [] }
  }

  // Args em array, shell:false → sem injeção. model opcional.
  const args = ["run"]
  if (p.model) args.push("-m", p.model)
  args.push(p.task)
  let exitCode = 0
  let stdout = ""
  let stderr = ""
  try {
    stdout = (exec("opencode", args, { cwd, stdio: "pipe", shell: false, timeout: p.timeout || 600000, encoding: "utf-8" }) || "").toString()
  } catch (e) {
    exitCode = typeof e.status === "number" ? e.status : 1
    stdout = (e.stdout || "").toString()
    stderr = (e.stderr || e.message || "").toString()
  }

  // Arquivos alterados via git (determinístico) — escopo do que mudou.
  const changedFiles = listChangedFiles(cwd, p.gitStatus || exec)

  return {
    status: exitCode === 0 ? "ok" : "failed",
    exitCode,
    summary: summarize(stdout, exitCode, changedFiles.length),
    changedFiles,
    ...(stderr ? { stderrTail: stderr.slice(-800) } : {}),
  }
}

function listChangedFiles(cwd, execOrFn) {
  try {
    const exec = typeof execOrFn === "function" ? execOrFn : defaultExecFileSync
    const out = (exec("git", ["status", "--porcelain"], { cwd, stdio: "pipe", shell: false, timeout: 15000, encoding: "utf-8" }) || "").toString()
    return out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
  } catch {
    return []
  }
}

function summarize(stdout, exitCode, nChanged) {
  const tail = (stdout || "").trim().split("\n").slice(-3).join(" | ").slice(0, 300)
  return `OpenCode exit=${exitCode}, ${nChanged} arquivo(s) alterado(s). ${tail}`
}
