import { execFileSync } from "child_process"
import { isWindows } from "./detector.js"
import { CODEBUFF, detectCodebuff } from "./codebuff.js"
import { FREEBUFF, detectFreebuff } from "./freebuff.js"

/**
 * Candidatos externos opt-in (PRD18 Sprint 5): Codebuff/Freebuff. Este módulo é
 * READ-ONLY — só detecta e reporta risco/prontidão, NUNCA instala nada. Os
 * descritores (disclosure, external_model_risk, network_required) vivem em
 * codebuff.js/freebuff.js; aqui agregamos + checamos o ambiente (shell/node/npm/proxy).
 */

export const CANDIDATE_ENFORCEMENT = Object.freeze(["candidate_adapter", "advisory_reviewer"])
const CANDIDATES = [{ desc: CODEBUFF, detect: detectCodebuff }, { desc: FREEBUFF, detect: detectFreebuff }]

/** Binário presente? Fail-open, sem efeito colateral. */
function hasBin(cmd, args = ["--version"]) {
  try { execFileSync(cmd, args, { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
}

/** Shell compatível p/ delegate no Windows (Git Bash ou WSL). Fora do Windows: sempre ok. */
export function shellCompat() {
  if (!isWindows()) return { ok: true, shell: "posix", gitBash: false, wsl: false }
  const gitBash = hasBin("bash")
  const wsl = hasBin("wsl", ["--status"])
  const shell = gitBash ? "git-bash" : (wsl ? "wsl" : "none")
  return { ok: gitBash || wsl, shell, gitBash, wsl }
}

/** Prontidão de ambiente (node/npm/proxy) — nenhum é instalado aqui. */
export function envReadiness() {
  const proxy = !!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY)
  return { node: hasBin("node"), npm: hasBin(isWindows() ? "npm.cmd" : "npm"), proxy }
}

/** Descrição honesta de um candidato + bloqueio de delegate por shell (Windows). */
function describeCandidate({ desc, present }, shell) {
  const delegateBlocked = isWindows() && !shell.ok
  return {
    id: desc.id, label: desc.label, present,
    enforcement: desc.enforcement, candidateAdapter: desc.candidateAdapter,
    reviewerOnly: desc.reviewerOnly, externalModelRisk: desc.externalModelRisk,
    networkRequired: desc.networkRequired, requiresAcceptance: desc.requiresAcceptance,
    disclosure: [...desc.disclosure],
    delegateBlocked,
    delegateBlockReason: delegateBlocked ? "Windows sem Git Bash/WSL — delegate indisponível (instale Git Bash ou habilite WSL)" : null,
    autoInstall: false,
  }
}

/** Relatório READ-ONLY dos candidatos externos. Nunca instala; só reporta. */
export function buildCandidateReport() {
  const shell = shellCompat()
  const env = envReadiness()
  const candidates = CANDIDATES.map(({ desc, detect }) => describeCandidate({ desc, present: detect() }, shell))
  return { schemaVersion: "gstack.candidates.v1", readonly: true, autoInstall: false, shell, env, candidates }
}
