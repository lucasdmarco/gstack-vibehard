import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs"
import { join } from "path"

/**
 * Headroom Routing seguro e OPT-IN (PRD24 Sprint 24.7). Só entra DEPOIS de 24.1
 * (OpenCode Doctor v2) e 24.2 (Tool Readiness), como manda o PRD.
 *
 * Invariantes (§9/§10, non-goals):
 *  - NUNCA `headroom wrap`, NUNCA MCP global, NUNCA editar ~/.codex/~/.claude/
 *    ~/.config/opencode. O roteamento é feito por um ENV project-scoped controlado
 *    pelo GStack (`.gstack/headroom/`) que o usuário faz `source` ANTES de abrir o
 *    harness — o GStack não injeta em shell global.
 *  - `readiness` só marca `routed` quando `headroom doctor` provar proxy+routed
 *    (garantido em readiness.js; habilitar aqui NÃO mente sobre estar roteado).
 *  - `disable --restore` reverte tudo que foi criado (reversível).
 *  - OpenCode fica FORA do routing automático até haver doctor específico.
 */

const DEFAULT_PROXY = "http://127.0.0.1:8787"
// harness → variável de base-URL que o Headroom intercepta.
const HARNESS_ENV = Object.freeze({ claude: "ANTHROPIC_BASE_URL", codex: "OPENAI_BASE_URL" })

function writeRouting(cwd, harness, envVar, proxyUrl) {
  const dir = join(cwd, ".gstack", "headroom")
  mkdirSync(dir, { recursive: true })
  const shPath = join(dir, "env.sh")
  const ps1Path = join(dir, "env.ps1")
  const manifestPath = join(dir, "routing.json")
  writeFileSync(shPath, `export ${envVar}="${proxyUrl}"\n`)
  writeFileSync(ps1Path, `$env:${envVar} = "${proxyUrl}"\n`)
  const files = [shPath, ps1Path]
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: "gstack.headroom.route.v1", harness, envVar, proxyUrl, files, createdAt: new Date().toISOString() }, null, 2) + "\n")
  return {
    enabled: true, harness, envVar, proxyUrl, dir, files, manifestPath,
    note: `Routing PROJECT-SCOPED criado. Faça \`source ${shPath}\` (ou \`. ${ps1Path}\`) ANTES de abrir o harness. O GStack NÃO injeta em shell global. Reverter: \`tools headroom disable --restore\`.`,
  }
}

/**
 * Habilita routing project-scoped (opt-in). Recusa harness não suportado e modo
 * global. `write:false` = dry-run. NUNCA toca config global nem roda `headroom wrap`.
 */
const refuseHarness = (h) => ({ enabled: false, refused: true, reason: `harness '${h || "?"}' fora do routing automático (use codex|claude; OpenCode exige doctor específico)` })
const refuseGlobal = () => ({ enabled: false, refused: true, reason: "só --project-only é suportado (routing global exigiria confirmação explícita e config global)" })
export function enableRouting(opts = {}) {
  const envVar = HARNESS_ENV[opts.harness]
  if (!envVar) return refuseHarness(opts.harness)
  if (opts.projectOnly === false) return refuseGlobal()
  const cwd = opts.cwd || process.cwd()
  const proxyUrl = opts.proxyUrl || DEFAULT_PROXY
  if (opts.write === false) return { enabled: false, dryRun: true, harness: opts.harness, envVar, proxyUrl }
  return writeRouting(cwd, opts.harness, envVar, proxyUrl)
}

// Lista os arquivos do manifest que ainda existem (best-effort).
function readManifestFiles(manifestPath) {
  try { return (JSON.parse(readFileSync(manifestPath, "utf-8")).files || []).filter((f) => existsSync(f)) }
  catch { return [] }
}

/** Reverte o routing project-scoped: remove os arquivos criados + o manifest + dir. */
export function disableRouting(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const dir = join(cwd, ".gstack", "headroom")
  const manifestPath = join(dir, "routing.json")
  if (!existsSync(manifestPath)) return { disabled: false, reason: "nenhum routing project-scoped ativo", removed: [] }
  const removed = readManifestFiles(manifestPath)
  removed.push(manifestPath)
  rmSync(dir, { recursive: true, force: true })
  return { disabled: true, removed }
}
