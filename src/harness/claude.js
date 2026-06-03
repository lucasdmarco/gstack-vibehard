import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { writeWithBackup, ensureDir, readJsonFile, mergeJson } from "../installer/merge.js"

const HOME = homedir()

const CLAUDE_DIR = join(HOME, ".claude")
const CLAUDE_SETTINGS = join(CLAUDE_DIR, "settings.json")
const CLAUDE_MD = join(HOME, "CLAUDE.md")
const ULTRA_MD = join(CLAUDE_DIR, "rules", "ultracode.md")
const MCP_CONFIG = join(HOME, ".mcp.json")

const claudeMdContent = `# CLAUDE.md — gstack_vibehard

## Identity
Sou fundador e CTO. Construo porque nao consigo nao construir.
O padrao e world-class. Inegociavel.

## Quality Gate
- Antes de entregar output, rode: python ~/.codex/hooks/qg.py --path . --level 1
- Se CRITICO/ALTO blocker: pare, corrija, re-execute QG, so entao entregue
- Se MEDIO/BAIXO: documente e entregue com notas

## Security Gate (deploy)
- dockerignore obrigatorio
- Multi-stage Dockerfile (sem --reload)
- Non-root user no container
- CORS por env var (nunca '*' em producao)
- Zero secrets hardcoded

## Skills disponiveis
- frontend-design — interfaces premium com taste-skill (4 engines + 3 dials)
- chronicle — memoria de sessoes indexada
- project-init — setup de projeto com variante backend

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

  if (config.claudeMd) {
    writeWithBackup(CLAUDE_MD, claudeMdContent)
    report.updated.push("~/CLAUDE.md")
  }

  if (config.ultracode) {
    writeWithBackup(ULTRA_MD, ultracodeContent)
    report.updated.push("~/.claude/rules/ultracode.md")
  }

  if (config.mcp) {
    const mcpSettings = {
      mcpServers: {
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
      },
    }

    const existing = readJsonFile(MCP_CONFIG)
    const merged = mergeJson(existing, mcpSettings)
    writeWithBackup(MCP_CONFIG, JSON.stringify(merged, null, 2))
    report.updated.push("~/.mcp.json")
  }

  return report
}
