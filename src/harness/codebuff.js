import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync } from "child_process"

/**
 * Codebuff — candidate adapter (PRD18 Sprint 5). OPT-IN: nada é instalado
 * automaticamente. Entra na trilha como REVIEWER advisory, nunca como gate final
 * (o determinístico decide). Usa modelos externos por rede — não é local/offline.
 */
export const CODEBUFF = Object.freeze({
  id: "codebuff",
  label: "Codebuff",
  enforcement: "advisory_reviewer",
  candidateAdapter: true,
  reviewerOnly: true,
  externalModelRisk: true,
  networkRequired: true,
  requiresAcceptance: false,
  disclosure: Object.freeze([
    "Usa modelos externos (rede obrigatória) — não roda local/offline.",
    "Reviewer ADVISORY: nunca é o gate final; o gate determinístico decide.",
    "Não use com código confidencial sem aceite explícito.",
  ]),
})

/** Detecção READ-ONLY (config presente ou binário no PATH). Fail-open, sem instalar. */
export function detectCodebuff() {
  if (existsSync(join(homedir(), ".codebuff"))) return true
  try { execFileSync("codebuff", ["--version"], { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
}
