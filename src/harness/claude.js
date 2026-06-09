import { existsSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { writeWithBackup, ensureDir, readJsonFile } from "../installer/merge.js"
import { isWindows } from "./detector.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PACKAGE_ROOT = dirname(__dirname)

const HOME = homedir()

const CLAUDE_DIR = join(HOME, ".claude")
const CLAUDE_HOOKS = join(CLAUDE_DIR, "hooks")
const CLAUDE_SETTINGS = join(CLAUDE_DIR, "settings.json")
const CLAUDE_MD = join(HOME, "CLAUDE.md")
const ULTRA_MD = join(CLAUDE_DIR, "rules", "ultracode.md")
const MCP_CONFIG = join(HOME, ".mcp.json")
const HOOKS_SOURCE = join(PACKAGE_ROOT, "hooks", "hooks")

const claudeMdContent = `# CLAUDE.md — gstack_vibehard

## Identity
Sou fundador e CTO. Construo porque nao consigo nao construir.
O padrao e world-class. Inegociavel.

## Quality Gate
- Antes de entregar output, rode: python3 ~/.claude/hooks/qg.py --path . --level 1
- (Se python3 nao existir, use: python ~/.claude/hooks/qg.py --path . --level 1)
- Se CRITICO/ALTO blocker: pare, corrija, re-execute QG, so entao entregue
- Se MEDIO/BAIXO: documente e entregue com notas

## Security Gate (deploy)
- dockerignore obrigatorio
- Multi-stage Dockerfile (sem --reload)
- Non-root user no container
- CORS por env var (nunca '*' em producao)
- Zero secrets hardcoded

## Skills disponiveis
- frontend-design — interfaces premium com taste-skill (4 engines + 3 dials) + design system detection
- chronicle — memoria de sessoes indexada
- project-init — setup de projeto com variante backend
- newproject — ativado por /newproject: Guided Architecture Walkthrough (10 passos)
- g_update — ativado por /g_update: atualizar gstack_vibehard

## Design System
ANTES de escrever qualquer codigo de frontend, pergunte ao usuario se ele tem um design system proprio.
Se sim, carregue a skill frontend-design para aplicar os tokens. Se nao, gere um.
O hook pre_tool_use_security.py bloqueia escrita de UI ate essa pergunta ser respondida.

## Nota de versao
Se ~/.gstack_vibehard/update_status.json mostrar latest > local, avise e sugira /g_update

## Dream
Auto-dream ON. Memorias persistentes entre sessoes.
`

const ultracodeContent = `# Ultracode — gstack_vibehard quality standards

## Engineering Standards
- Zero bare except/ catch
- Zero any types
- Zero secrets hardcoded
- Zero queries without limit
- Zero endpoints without input validation

## Agent Quality Gate
All agents MUST run QG before delivery.
Full protocol in .claude/rules/qg-gate.md (symlinked from project).

## Security First
Security is not a phase. It is foundation.
OWASP Top 10 audit before every deploy.
`

export async function installClaude(config, report) {
  ensureDir(CLAUDE_DIR)
  ensureDir(join(CLAUDE_DIR, "rules"))

  // Install hooks to ~/.claude/hooks/ from package source
  if (config.hooks) {
    ensureDir(CLAUDE_HOOKS)
    const fs = await import("fs")
    let hooksSource = HOOKS_SOURCE
    if (!existsSync(hooksSource)) {
      // Fallback para compat retroativa: copia de ~/.gstack/hooks/ ou ~/.codex/hooks/
      const gstackHooks = join(HOME, ".gstack", "hooks")
      const codexHooks = join(HOME, ".codex", "hooks")
      if (existsSync(gstackHooks)) hooksSource = gstackHooks
      else if (existsSync(codexHooks)) hooksSource = codexHooks
    }
    if (existsSync(hooksSource)) {
      const hooks = fs.readdirSync(hooksSource).filter((f) => f.endsWith(".py"))
      for (const hook of hooks) {
        const src = join(hooksSource, hook)
        const dst = join(CLAUDE_HOOKS, hook)
        fs.cpSync(src, dst, { recursive: true })
        report.added.push(`claude hook: ${hook}`)
      }
    }
  }

  if (config.claudeMd) {
    writeWithBackup(CLAUDE_MD, claudeMdContent)
    report.updated.push("~/CLAUDE.md")
  }

  if (config.ultracode) {
    writeWithBackup(ULTRA_MD, ultracodeContent)
    report.updated.push("~/.claude/rules/ultracode.md")
  }

  if (config.mcp) {
    const defaultMcpServers = {
      fallow: {
        command: "npx",
        args: ["-y", "fallow", "mcp"],
      },
      supabase: {
        command: "npx",
        args: ["-y", "@supabase/mcp-server", "--project-ref", "${SUPABASE_PROJECT_REF}"],
        env: {
          SUPABASE_ACCESS_TOKEN: "${SUPABASE_ACCESS_TOKEN}",
        },
      },
      playwright: {
        command: "npx",
        args: ["-y", "@playwright/mcp"],
      },
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp", "--api-key", "${CONTEXT7_API_KEY}"],
        env: {
          CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}",
        },
      },
      gbrain: {
        command: "gbrain",
        args: ["serve"],
      },
      graphify: {
        command: "python",
        args: ["-m", "graphify.serve", "graphify-out/graph.json"],
      },
      headroom: {
        command: "headroom",
        args: ["mcp"],
      },
    }

    const existing = readJsonFile(MCP_CONFIG)
    const existingServers = existing?.mcpServers || {}
    // Deep merge: preserve user's custom servers AND their custom configs for default-named servers
    const finalMcpServers = {}
    for (const [key, defaultValue] of Object.entries(defaultMcpServers)) {
      if (key in existingServers) {
        const userVal = existingServers[key]
        if (typeof userVal === "object" && typeof defaultValue === "object") {
          finalMcpServers[key] = { ...defaultValue, ...userVal }
        } else {
          finalMcpServers[key] = userVal
        }
      } else {
        finalMcpServers[key] = defaultValue
      }
    }
    // Add user servers that aren't in defaults
    for (const [key, val] of Object.entries(existingServers)) {
      if (!(key in defaultMcpServers)) {
        finalMcpServers[key] = val
      }
    }
    writeWithBackup(MCP_CONFIG, JSON.stringify({ mcpServers: finalMcpServers }, null, 2))
    report.updated.push("~/.mcp.json")

    // Also write to ~/.claude/settings.json so MCP servers appear in Claude Code
    const claudeSettings = readJsonFile(CLAUDE_SETTINGS) || {}
    const mergedSettings = { ...claudeSettings }
    const existingClaudeServers = claudeSettings.mcpServers || {}
    mergedSettings.mcpServers = { ...finalMcpServers }
    for (const [key, val] of Object.entries(existingClaudeServers)) {
      if (!(key in defaultMcpServers)) {
        mergedSettings.mcpServers[key] = val
      }
    }
    writeWithBackup(CLAUDE_SETTINGS, JSON.stringify(mergedSettings, null, 2))
    report.updated.push("~/.claude/settings.json")
  }

  return report
}
