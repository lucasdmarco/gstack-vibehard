import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { writeWithBackup, ensureDir } from "../installer/merge.js"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = dirname(__dirname)

const HOOKS_SOURCE = join(PACKAGE_ROOT, "hooks", "hooks")
const SKILLS_SOURCE = join(PACKAGE_ROOT, "skills", "skills")
const TEMPLATE_SOURCE = join(PACKAGE_ROOT, "templates", "templates")

function resolvePythonCmd() {
  try { execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 3000 }); return "python3" } catch { return "python" }
}

export async function installCodex(config, report) {
  const hooksDir = join(HOME, ".codex", "hooks")
  const configFile = join(HOME, ".codex", "config.toml")

  ensureDir(hooksDir)

  if (config.hooks) {
    const fs = await import("fs")
    const hooks = fs.readdirSync(HOOKS_SOURCE).filter((f) => f.endsWith(".py"))
    for (const hook of hooks) {
      const src = join(HOOKS_SOURCE, hook)
      const dst = join(hooksDir, hook)
      fs.copyFileSync(src, dst)
      report.added.push(`hook ${hook}`)
    }
  }

  if (config.template) {
    mergeCodexConfig(configFile)
    report.updated.push("~/.codex/config.toml (merge nao-destrutivo)")
  }

  return report
}

/**
 * Tabelas/servidores MCP de propriedade do gstack — usados tanto no merge do
 * install quanto na limpeza do uninstall.
 */
export const GSTACK_MCP_SERVERS = [
  "fallow", "supabase", "playwright", "context7", "gbrain", "graphify", "headroom",
]
export const GSTACK_HOOK_KEYS = ["on_session_start", "on_stop", "pre_tool_use", "post_tool_use"]

function buildGstackConfig() {
  const skillsDir = join(HOME, ".agents", "skills").replaceAll("\\", "/")
  const hooksDirPosix = join(HOME, ".codex", "hooks").replaceAll("\\", "/")
  const pythonCmd = resolvePythonCmd()
  return {
    hooks: {
      on_session_start: [`${pythonCmd} ${hooksDirPosix}/session_start.py`],
      on_stop: [`${pythonCmd} ${hooksDirPosix}/stop.py`],
      pre_tool_use: [`${pythonCmd} ${hooksDirPosix}/pre_tool_use_security.py`],
      post_tool_use: [`${pythonCmd} ${hooksDirPosix}/stop.py`],
    },
    agent: {
      skills_dir: skillsDir,
      instructions: [
        "Comandos disponiveis:",
        "  /newproject — Guided Architecture Walkthrough (10 passos com design system)",
        "  /g_update   — Atualizar gstack_vibehard para versao mais recente",
        "",
        "Design System: ANTES de escrever frontend, pergunte se usuario tem DS proprio.",
        "Se nao perguntar, o hook pre_tool_use_security.py vai bloquear a escrita.",
        "",
        "Se ~/.gstack_vibehard/update_status.json mostrar latest > local, avise e sugira /g_update",
      ].join("\n"),
    },
    mcp_servers: {
      fallow: { command: "npx", args: ["-y", "fallow", "mcp"] },
      supabase: { command: "npx", args: ["-y", "@supabase/mcp-server", "--project-ref", "${SUPABASE_PROJECT_REF}"] },
      playwright: { command: "npx", args: ["-y", "@playwright/mcp"] },
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp", "--api-key", "${CONTEXT7_API_KEY}"] },
      gbrain: { command: "gbrain", args: ["serve"] },
      graphify: { command: resolvePythonCmd(), args: ["-m", "graphify.serve", "graphify-out/graph.json"] },
      headroom: { command: "headroom", args: ["mcp"] },
    },
  }
}

/**
 * Faz merge nao-destrutivo da config gstack no ~/.codex/config.toml.
 * - hooks: gstack vence (caminhos podem mudar entre versoes), mantem extras do usuario
 * - agent / mcp_servers: usuario vence (preserva customizacoes); gstack so adiciona o que falta
 * Exportada para teste com path injetavel.
 */
export function mergeCodexConfig(configFile, readImpl = readFileSync, writeImpl = writeWithBackup) {
  const gstack = buildGstackConfig()
  let existing = {}
  if (existsSync(configFile)) {
    try {
      existing = parseToml(readImpl(configFile, "utf-8")) || {}
    } catch {
      // config.toml corrompido — preserva como .bak e parte do zero gstack
      existing = {}
    }
  }
  const merged = { ...existing }
  // hooks: gstack vence nas suas chaves, mantem outras do usuario
  merged.hooks = { ...(existing.hooks || {}), ...gstack.hooks }
  // agent: usuario vence
  merged.agent = { ...gstack.agent, ...(existing.agent || {}) }
  // mcp_servers: usuario vence (preserva config customizada dos servidores)
  merged.mcp_servers = { ...gstack.mcp_servers, ...(existing.mcp_servers || {}) }

  writeImpl(configFile, stringifyToml(merged))
}

/**
 * Remove apenas as chaves de propriedade do gstack do config.toml, preservando
 * todo o restante. Usada pelo uninstall.
 */
export function stripGstackFromCodexConfig(configFile, readImpl = readFileSync, writeImpl = writeWithBackup) {
  if (!existsSync(configFile)) return false
  let parsed
  try {
    parsed = parseToml(readImpl(configFile, "utf-8")) || {}
  } catch {
    return false
  }
  if (parsed.hooks) {
    for (const k of GSTACK_HOOK_KEYS) delete parsed.hooks[k]
    if (Object.keys(parsed.hooks).length === 0) delete parsed.hooks
  }
  if (parsed.mcp_servers) {
    // So remove um servidor gstack se ele NAO foi customizado pelo usuario
    // (i.e., ainda igual ao default que o gstack escreveu). Preserva servidores
    // que o usuario tunou mesmo compartilhando nome com um default gstack.
    const defaults = buildGstackConfig().mcp_servers
    for (const s of GSTACK_MCP_SERVERS) {
      if (parsed.mcp_servers[s] && JSON.stringify(parsed.mcp_servers[s]) === JSON.stringify(defaults[s])) {
        delete parsed.mcp_servers[s]
      }
    }
    if (Object.keys(parsed.mcp_servers).length === 0) delete parsed.mcp_servers
  }
  // agent: remove apenas se ainda for o bloco gstack (skills_dir gstack)
  if (parsed.agent && typeof parsed.agent.skills_dir === "string"
      && parsed.agent.skills_dir.includes(".agents/skills")) {
    delete parsed.agent
  }
  writeImpl(configFile, stringifyToml(parsed))
  return true
}
