import { existsSync } from "fs"
import { runDelegation } from "../delegation/opencode.js"
import { runDevinDelegation } from "../delegation/devin.js"
import { checkTrackedSecrets } from "../delegation/worktree.js"
import { recordAction } from "../vfa/provenance.js"
import { confirm, success, warn, error, info, section } from "../cli/index.js"

function parseFlags(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--task") out.task = args[++i]
    else if (a === "--model") out.model = args[++i]
    else if (a === "--max-iterations") out.maxIterations = parseInt(args[++i], 10)
    else if (a === "--worktree") out.worktree = true
    else if (a === "--cloud-handoff") out.cloudHandoff = true
    else if (a === "--allow-tracked-secrets") out.allowTrackedSecrets = true
    else if (a === "--yes" || a === "-y") out.yes = true
    else out._.push(a)
  }
  return out
}

const TARGETS = { opencode: runDelegation, devin: runDevinDelegation }

function usage() {
  section("delegate — delegar tarefa para outro harness")
  info("  gstack_vibehard delegate <opencode|devin> --task \"...\" [--model M] [--worktree] [--yes]")
  info("  --worktree: roda numa git worktree isolada (não toca o branch principal).")
  info("  --cloud-handoff (só devin): pode enviar repo/diff/contexto p/ Devin Cloud — SEMPRE confirma.")
  info("  BLOQUEIA se houver .env rastreado no git (libere com --allow-tracked-secrets).")
}

/** Bloqueia se houver .env rastreado. Retorna true se pode prosseguir. */
function secretsGate(cwd, flags, exec) {
  const tracked = checkTrackedSecrets(cwd, exec)
  if (!tracked.length) return { ok: true }
  if (!flags.allowTrackedSecrets) {
    error(`BLOQUEADO: ${tracked.length} arquivo(s) .env RASTREADO(s) no git (${tracked.slice(0, 3).join(", ")}).`)
    warn("A outra IA leria seus segredos ao rodar aqui. NÃO deleguei.")
    info("Corrija: `git rm --cached .env && echo .env >> .gitignore`. Ou libere com `--allow-tracked-secrets`.")
    return { ok: false, tracked }
  }
  warn(`Prosseguindo com ${tracked.length} .env rastreado(s) — você liberou via --allow-tracked-secrets.`)
  return { ok: true }
}

/** Cloud handoff (só devin) SEMPRE exige confirmação humana — nem --yes pula. */
async function cloudHandoffGate(flags, doConfirm) {
  if (!flags.cloudHandoff) return { ok: true, cloud: false }
  warn("CLOUD HANDOFF: isto pode enviar repo, branch, contexto e diff NÃO comitado para o Devin Cloud.")
  info("  Recomendo commitar/stashar o que não deve sair da máquina antes de prosseguir.")
  if (!process.stdin.isTTY) { error("Cloud handoff exige confirmação interativa — nada foi enviado."); return { ok: false, cloud: true } }
  const ok = await doConfirm("Confirmo o envio para o Devin Cloud?", false)
  if (!ok) { info("Cloud handoff cancelado — nada foi enviado."); return { ok: false, cloud: true } }
  return { ok: true, cloud: true }
}

function renderOk(result) {
  success(result.summary)
  if (result.changedFiles.length) info(`Alterados: ${result.changedFiles.slice(0, 20).join(", ")}`)
  if (result.reviewBranch) info(`Revise/mergeie (NUNCA auto-merge): git diff ${result.reviewBranch}`)
}
function renderNeedsReview(result) {
  warn(result.summary)
  for (const f of (result.reviewFindings || []).slice(0, 5)) warn(`  • ${f.file}:${f.line} ${f.rule} — ${f.message}`)
  if (result.reviewBranch) info(`NÃO mergeie direto — revise o branch: git diff ${result.reviewBranch}`)
}
function renderFailed(result) {
  warn(result.summary)
  if (result.stderrTail) info(`stderr (tail): ${result.stderrTail}`)
}
const RENDER = { ok: renderOk, needs_review: renderNeedsReview, failed: renderFailed }
function renderResult(result, label) {
  const fn = RENDER[result.status] || ((r) => error(r.summary || `${label}: ${r.status}`))
  fn(result)
}

/** Confirmação da delegação em si (o cloud handoff já foi confirmado à parte). */
async function confirmDelegation(target, worktree, flags, opts, doConfirm) {
  if (flags.yes || opts.yes) return true
  if (!process.stdin.isTTY) { error(`Modo não-interativo: confirme com --yes para delegar ao ${target}.`); return false }
  return doConfirm(`Delegar ao ${target}? Roda no ${worktree ? "worktree isolado" : "diretório atual"}.`, false)
}

function recordProvenance(cwd, target, task, result, cloud) {
  if (!existsSync(cwd)) return // não cria raiz nova só p/ provenance (best-effort)
  try {
    recordAction(cwd, {
      runId: `delegate-${target}-${Date.now().toString(36)}`,
      intent: `delegate:${target}`,
      target: { kind: "task", pathOrName: String(task).slice(0, 200) },
      policy: { decision: result.status === "ok" || result.status === "needs_review" ? "allow" : "deny", rules: cloud ? ["human-confirmed", "cloud-handoff"] : ["human-confirmed"] },
    })
  } catch { /* provenance best-effort */ }
}

/** Valida target/task/flags antes de qualquer efeito. Retorna código de erro ou null. */
function preflight(target, task, flags) {
  if (!TARGETS[target]) return "usage"
  if (!task) return "no_task"
  if (flags.cloudHandoff && target !== "devin") return "cloud_only_devin"
  return null
}

/** Imprime o cabeçalho/erros de preflight. Retorna true se pode prosseguir. */
function handlePreflight(target, task, flags) {
  const bad = preflight(target, task, flags)
  if (bad === "usage") { usage(); return false }
  section(`delegate ${target} — ${task || "(sem task)"}`)
  if (bad === "no_task") { error("Forneça --task \"descrição da tarefa\""); return false }
  if (bad === "cloud_only_devin") { error("--cloud-handoff só se aplica ao devin."); return false }
  return true
}

export async function delegateCommand(args = [], opts = {}) {
  const { cwd = process.cwd(), confirm: doConfirm = confirm, exec } = opts
  const target = args[0]
  const flags = parseFlags(args.slice(1))
  const task = flags.task

  if (!handlePreflight(target, task, flags)) return

  const sec = secretsGate(cwd, flags, exec)
  if (!sec.ok) return { status: "blocked_tracked_secrets", tracked: sec.tracked }

  const cloud = await cloudHandoffGate(flags, doConfirm)
  if (!cloud.ok) return { status: "cloud_handoff_declined" }

  if (!(await confirmDelegation(target, flags.worktree, flags, opts, doConfirm))) { info("Delegação cancelada."); return }

  const result = TARGETS[target]({ task, cwd, model: flags.model, maxIterations: flags.maxIterations, worktree: flags.worktree, cloudHandoff: cloud.cloud, exec })
  recordProvenance(cwd, target, task, result, cloud.cloud)
  renderResult(result, target)
  return result
}
