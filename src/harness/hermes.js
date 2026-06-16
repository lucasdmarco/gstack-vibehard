import { existsSync, readFileSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { execFileSync as defaultExec } from "child_process"
import { ensureDir, copyDirSync, readJsonFile } from "../installer/merge.js"
import { writeInstructionalGuidance } from "./instructional.js"

/**
 * Hermes (NousResearch) fala MCP nas DUAS direções (`hermes mcp add` para
 * consumir servidores, `hermes mcp serve` para se expor). Config vive em
 * ~/.hermes/ (skills/ + AGENTS.md). A integração é em 3 camadas, da mais
 * garantida à best-effort:
 *   1. Skills copiadas para ~/.hermes/skills/        (filesystem — garantido)
 *   2. Guidance instrucional em ~/.hermes/AGENTS.md   (filesystem — garantido)
 *   3. Registro dos MCP servers do gstack via `hermes mcp add`, SÓ se o binário
 *      existir, totalmente guardado (falha = skip, NUNCA fatal). Deixamos o
 *      próprio Hermes escrever seu config no formato dele — não adivinhamos o
 *      schema YAML (não corrompe config alheio).
 */

function resolveProjectRoot() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return dir
}

function hermesAvailable(exec) {
  try { exec("hermes", ["--version"], { stdio: "pipe", timeout: 3000 }); return true }
  catch { return false }
}

/**
 * @param {object} config  { mcp?: boolean, skills?: boolean }
 * @param {object} report  { added, updated, skipped, errors }
 * @param {object} deps    { exec?, home?, projectRoot? }  (seams para testes herméticos)
 */
export async function installHermes(config = {}, report, deps = {}) {
  const exec = deps.exec || defaultExec
  const home = deps.home || homedir()
  const projectRoot = deps.projectRoot || resolveProjectRoot()

  const hermesDir = join(home, ".hermes")
  const skillsDst = join(hermesDir, "skills")
  const agentsFile = join(hermesDir, "AGENTS.md")
  ensureDir(hermesDir)
  ensureDir(skillsDst)

  // 1. Skills (filesystem garantido) — não sobrescreve skills do usuário.
  if (config.skills !== false) {
    const skillsSrc = join(projectRoot, "skills", "skills")
    if (existsSync(skillsSrc)) {
      const dirs = readdirSync(skillsSrc, { withFileTypes: true }).filter((d) => d.isDirectory())
      for (const skill of dirs) {
        const dst = join(skillsDst, skill.name)
        if (existsSync(dst)) { report.skipped.push(`hermes skill: ${skill.name} (ja existe)`); continue }
        copyDirSync(join(skillsSrc, skill.name), dst)
        report.added.push(`hermes skill: ${skill.name}`)
      }
    }
  }

  // 2. Guidance instrucional (mesmo protocolo QG/memória/tokens dos demais harnesses).
  const readFile = (p) => (existsSync(p) ? readFileSync(p, "utf-8") : "")
  writeInstructionalGuidance(agentsFile, report, readFile)

  // 3. Registro MCP best-effort — só toca o Hermes se o binário existir.
  if (config.mcp !== false && hermesAvailable(exec)) {
    const base = readJsonFile(join(projectRoot, "mcp-configs", "base.mcp.json"))
    const servers = (base && base.mcpServers) || {}
    let registered = 0
    for (const [name, def] of Object.entries(servers)) {
      if (!def || !def.command) continue
      try {
        // `hermes mcp add <name> --command <cmd> [--arg <a>]...` — o Hermes valida
        // e persiste no formato dele. Idempotente do lado do Hermes (re-add atualiza).
        const argv = ["mcp", "add", name, "--command", String(def.command)]
        for (const a of def.args || []) argv.push("--arg", String(a))
        exec("hermes", argv, { stdio: "pipe", timeout: 15000 })
        report.added.push(`hermes mcp: ${name}`)
        registered++
      } catch (e) {
        report.skipped.push(`hermes mcp ${name} (best-effort): ${(e.message || "falhou").slice(0, 60)}`)
      }
    }
    return { skills: true, guidance: true, mcpRegistered: registered }
  }

  report.skipped.push("hermes mcp: binario ausente — skills + guidance aplicados (sem registro MCP)")
  return { skills: true, guidance: true, mcpRegistered: 0 }
}
