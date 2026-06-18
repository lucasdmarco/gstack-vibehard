import { runDelegation } from "../delegation/opencode.js"
import { checkTrackedSecrets } from "../delegation/worktree.js"
import { confirm, success, warn, error, info, section } from "../cli/index.js"

function parseFlags(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--task") out.task = args[++i]
    else if (a === "--model") out.model = args[++i]
    else if (a === "--max-iterations") out.maxIterations = parseInt(args[++i], 10)
    else if (a === "--worktree") out.worktree = true
    else if (a === "--allow-tracked-secrets") out.allowTrackedSecrets = true
    else if (a === "--yes" || a === "-y") out.yes = true
    else out._.push(a)
  }
  return out
}

export async function delegateCommand(args = [], opts = {}) {
  const target = args[0]
  const flags = parseFlags(args.slice(1))
  const cwd = opts.cwd || process.cwd()

  if (target !== "opencode") {
    section("delegate — delegar tarefa para outro harness")
    info("  gstack_vibehard delegate opencode --task \"...\" [--model M] [--max-iterations N] [--worktree] [--yes]")
    info("  Delega ao OpenCode (modelo/free tier configurado por você). Opt-in, com confirmação.")
    info("  --worktree: roda numa git worktree isolada (não toca o branch principal).")
    info("  BLOQUEIA se houver .env rastreado no git (libere com --allow-tracked-secrets).")
    return
  }

  const task = flags.task
  section(`delegate opencode — ${task || "(sem task)"}`)
  if (!task) { error("Forneça --task \"descrição da tarefa\""); return }

  // Higiene de segredos (vale para TODA delegação, com ou sem --worktree):
  // se houver .env RASTREADO no git, a outra IA o leria — no checkout da worktree
  // OU direto do diretório real (modo padrão roda `opencode run` no cwd). BLOQUEIA
  // por padrão; exige override explícito.
  const tracked = checkTrackedSecrets(cwd, opts.exec)
  if (tracked.length && !flags.allowTrackedSecrets) {
    error(`BLOQUEADO: ${tracked.length} arquivo(s) .env RASTREADO(s) no git (${tracked.slice(0, 3).join(", ")}).`)
    warn("A outra IA leria seus segredos ao rodar aqui. NÃO deleguei.")
    info("Corrija: `git rm --cached .env && echo .env >> .gitignore`.")
    info("Ou, se tiver CERTEZA, libere explicitamente com `--allow-tracked-secrets`.")
    return { status: "blocked_tracked_secrets", tracked }
  }
  if (tracked.length && flags.allowTrackedSecrets) {
    warn(`Prosseguindo com ${tracked.length} .env rastreado(s) — você liberou via --allow-tracked-secrets.`)
  }

  // Confirmação obrigatória (a menos de --yes / não-interativo controlado)
  const skipConfirm = flags.yes || opts.yes
  if (!skipConfirm) {
    if (!process.stdin.isTTY) {
      error("Modo não-interativo: confirme com --yes para delegar ao OpenCode.")
      return
    }
    const ok = await confirm(`Delegar ao OpenCode? Vai rodar 'opencode run' no diretório atual.`, false)
    if (!ok) { info("Delegação cancelada."); return }
  }

  const result = runDelegation({
    task, cwd, model: flags.model, maxIterations: flags.maxIterations,
    worktree: flags.worktree, exec: opts.exec,
  })
  switch (result.status) {
    case "ok":
      success(result.summary)
      if (result.changedFiles.length) info(`Alterados: ${result.changedFiles.slice(0, 20).join(", ")}`)
      if (result.reviewBranch) info(`Revise/mergeie: git merge ${result.reviewBranch}`)
      break
    case "failed":
      warn(result.summary)
      if (result.stderrTail) info(`stderr (tail): ${result.stderrTail}`)
      break
    case "opencode_missing":
    case "invalid_task":
      error(result.summary)
      break
    default:
      warn(`Resultado: ${result.status} — ${result.summary}`)
  }
  return result
}
