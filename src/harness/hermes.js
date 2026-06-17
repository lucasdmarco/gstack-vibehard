import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { ensureDir, copyDirSync, readJsonFile } from "../installer/merge.js"
import { writeInstructionalGuidance } from "./instructional.js"

/**
 * Hermes (NousResearch). Integração em 3 camadas, da mais garantida à mais cuidadosa:
 *   1. Skills → ~/.hermes/skills/ (filesystem; não sobrescreve as do usuário).
 *   2. Guidance instrucional → ~/.hermes/AGENTS.md.
 *   3. MCP servers → ~/.hermes/config.yaml em `mcp_servers` (schema VERIFICADO na doc
 *      oficial: command/args/env + `enabled`).
 *
 * Segurança (Hermes roda em VPS — NÃO podemos quebrar um config existente):
 *  - `hermes mcp add` é INTERATIVO (picker) → NUNCA o shelamos (risco de travar).
 *  - Se ~/.hermes/config.yaml JÁ EXISTE, NÃO o tocamos: escrevemos um snippet
 *    mergeável em ~/.hermes/gstack-mcp-servers.yaml + orientação. O usuário mescla
 *    e roda /reload-mcp.
 *  - Se NÃO existe, criamos um com `mcp_servers` e `enabled: false` (Hermes não
 *    tenta conectar até o usuário habilitar o que de fato tem instalado).
 */

function resolveProjectRoot() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return dir
}

/** Escapa uma string para um escalar YAML entre aspas duplas. */
function yamlStr(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/**
 * Emite o bloco `mcp_servers` (YAML) a partir do base.mcp.json. Determinístico,
 * sem dependência. `enabled: false` por padrão (seguro). Valores são do PRÓPRIO
 * gstack (sem dado do usuário).
 */
export function emitMcpServersYaml(servers) {
  const lines = ["mcp_servers:"]
  for (const [name, def] of Object.entries(servers || {})) {
    if (!def || !def.command) continue
    lines.push(`  ${name}:`)
    lines.push(`    command: ${yamlStr(def.command)}`)
    const args = Array.isArray(def.args) ? def.args : []
    lines.push(`    args: [${args.map(yamlStr).join(", ")}]`)
    if (def.env && Object.keys(def.env).length) {
      lines.push("    env:")
      for (const [k, v] of Object.entries(def.env)) lines.push(`      ${k}: ${yamlStr(v)}`)
    }
    // enabled:false → Hermes não conecta até o usuário habilitar o que tem instalado.
    lines.push("    enabled: false")
  }
  return lines.join("\n") + "\n"
}

const YAML_HEADER = [
  "# gstack_vibehard — MCP servers (gerado).",
  "# enabled:false por seguranca. Habilite os que voce tem instalados e rode /reload-mcp no Hermes.",
  "",
].join("\n")

/**
 * @param {object} config  { mcp?, skills? }
 * @param {object} report  { added, updated, skipped, errors }
 * @param {object} deps    { home?, projectRoot? }
 */
export async function installHermes(config = {}, report, deps = {}) {
  const home = deps.home || homedir()
  const projectRoot = deps.projectRoot || resolveProjectRoot()

  const hermesDir = join(home, ".hermes")
  const skillsDst = join(hermesDir, "skills")
  const agentsFile = join(hermesDir, "AGENTS.md")
  const configYaml = join(hermesDir, "config.yaml")
  const snippetYaml = join(hermesDir, "gstack-mcp-servers.yaml")
  ensureDir(hermesDir)
  ensureDir(skillsDst)

  // 1. Skills (não sobrescreve as do usuário).
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

  // 2. Guidance instrucional.
  const readFile = (p) => (existsSync(p) ? readFileSync(p, "utf-8") : "")
  writeInstructionalGuidance(agentsFile, report, readFile)

  // 3. MCP servers — escrita SEGURA, nunca tocando um config.yaml existente.
  if (config.mcp !== false) {
    const base = readJsonFile(join(projectRoot, "mcp-configs", "base.mcp.json"))
    const servers = (base && base.mcpServers) || {}
    const block = emitMcpServersYaml(servers)
    const configExisted = existsSync(configYaml)

    if (!configExisted) {
      // Não existe → criamos um config mínimo (nada do usuário a preservar).
      writeFileSync(configYaml, YAML_HEADER + block)
      report.added.push("hermes mcp: ~/.hermes/config.yaml criado (mcp_servers, enabled:false)")
    } else {
      // JÁ existe → NÃO tocamos. Snippet lateral mergeável + orientação.
      writeFileSync(snippetYaml, YAML_HEADER + block)
      report.skipped.push(
        "hermes mcp: config.yaml preservado — snippet em ~/.hermes/gstack-mcp-servers.yaml. " +
        "Mescle em `mcp_servers` (habilite os que tem) e rode /reload-mcp."
      )
    }
    return { skills: true, guidance: true, mcpConfig: configExisted ? "snippet" : "created" }
  }

  return { skills: true, guidance: true, mcpConfig: "none" }
}
