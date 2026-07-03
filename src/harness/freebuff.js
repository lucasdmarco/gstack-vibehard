import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync } from "child_process"

/**
 * Freebuff — candidate adapter (PRD18 Sprint 5). OPT-IN e com disclosure REFORÇADO:
 * a camada gratuita pode parecer local mas usa rede externa, exibe anúncios/texto e
 * roteia por modelos externos. Aceite interativo é OBRIGATÓRIO na primeira vez
 * (mesmo com `--yes`) — o delegate real (Sprint 6) honra isso.
 */
export const FREEBUFF = Object.freeze({
  id: "freebuff",
  label: "Freebuff",
  enforcement: "advisory_reviewer",
  candidateAdapter: true,
  reviewerOnly: true,
  externalModelRisk: true,
  networkRequired: true,
  requiresAcceptance: true,
  disclosure: Object.freeze([
    "NÃO é local/offline: usa rede externa mesmo parecendo gratuito no terminal.",
    "Pode exibir anúncios / texto patrocinado.",
    "Roteia por modelos externos — seu código sai da máquina.",
    "Reviewer ADVISORY: nunca é o gate final.",
    "Não use com código confidencial sem aceite explícito (exigido na 1ª vez).",
  ]),
})

/** Detecção READ-ONLY (config presente ou binário no PATH). Fail-open, sem instalar. */
export function detectFreebuff() {
  if (existsSync(join(homedir(), ".freebuff"))) return true
  try { execFileSync("freebuff", ["--version"], { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
}
