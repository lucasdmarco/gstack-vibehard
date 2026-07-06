import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execFileSync } from "child_process"
import { writeWithBackup, ensureDir, readJsonFile, mergeJson } from "../installer/merge.js"
import { isWindows } from "./detector.js"

const HOME = homedir()
const MCP_CONFIG = join(HOME, ".mcp.json")

export async function installHeadroomPkg(warn, info, uvBin, exec = execFileSync) {
  const attempts = [
    { label: "headroom-ai[proxy] (latest)", pkg: "headroom-ai[proxy]" },
    { label: "headroom-ai[proxy]==0.20.15 (wheel)", pkg: "headroom-ai[proxy]==0.20.15" },
    { label: "headroom-ai==0.20.15 (wheel, sem extras)", pkg: "headroom-ai==0.20.15" },
  ]
  // Opt-in explícito para tocar o Python do SISTEMA (default: isolado, sem poluir).
  const allowSystem = process.env.GSTACK_HEADROOM_SYSTEM === "1"

  for (const attempt of attempts) {
    try {
      if (uvBin) {
        // `uv tool install` = ambiente ISOLADO (como o graphify), sem --system.
        exec(uvBin, ["tool", "install", attempt.pkg], { stdio: "pipe", timeout: 120000, shell: false })
      } else {
        // pip no site do USUÁRIO (não no sistema).
        exec("pip", ["install", "--user", attempt.pkg], { stdio: "pipe", timeout: 120000, shell: false })
      }
      return true
    } catch (e) {
      info(`headroom: ${attempt.label} — falhou (${e.message || e}), tentando proxima...`)
    }
  }

  // Último recurso explícito: só toca o Python do sistema com GSTACK_HEADROOM_SYSTEM=1.
  if (allowSystem) {
    try {
      const bin = uvBin || "uv"
      exec(bin, ["pip", "install", "--system", "headroom-ai==0.20.15"], { stdio: "pipe", timeout: 120000, shell: false })
      warn("headroom: instalado no Python do SISTEMA (GSTACK_HEADROOM_SYSTEM=1).")
      return true
    } catch (e) {
      info(`headroom: fallback --system — falhou (${e.message || e})`)
    }
  }

  return false
}

export async function installHeadroom(deps, report) {
  const { warn, success, info, uvBin } = deps

  info("headroom: Instalando...")

  const installed = await installHeadroomPkg(warn, info, uvBin)

  if (!installed) {
    warn("headroom: todas as tentativas falharam. Instale manualmente: uv pip install \"headroom-ai[proxy]\"")
    info("  Se estiver no Windows Python 3.14, tente: uv pip install --system \"headroom-ai==0.20.15\"")
    return
  }

  // Verify installation
  try {
    const ver = execFileSync("headroom", ["--version"], { stdio: "pipe", timeout: 5000, shell: false }).toString().trim()
    success(`headroom: ${ver}`)
    report.added.push("headroom (context compressor)")
  } catch (e) {
    warn(`headroom: instalado mas --version falhou (${e.message || e})`)
  }

  // NUNCA `headroom wrap` (removido na v3.76.0 — achado P1 da máquina limpa):
  // o wrap muda config de harness FORA do manifest do gstack (o instalador rtk do
  // headroom chegou a registrar hooks no Claude Code antes de falhar — escrita
  // global não rastreada, uninstall não restauraria). Routing é EXCLUSIVAMENTE
  // opt-in e project-scoped: `gstack_vibehard tools headroom enable --harness
  // codex|claude --project-only` (reversível com `disable --restore`).
  info("headroom: routing NÃO configurado automaticamente (opt-in: `gstack_vibehard tools headroom enable --harness codex|claude --project-only`)")

  // Add headroom to MCP servers (evitar duplicacao)
  const existing = readJsonFile(MCP_CONFIG)
  if (existing?.mcpServers?.headroom) {
    info("headroom MCP ja configurado em ~/.mcp.json (pulado)")
  } else {
    const mcpSettings = {
      mcpServers: {
        headroom: {
          command: "headroom",
          args: ["mcp"],
        },
      },
    }
    const merged = mergeJson(existing, mcpSettings)
    writeWithBackup(MCP_CONFIG, JSON.stringify(merged, null, 2))
    success("headroom MCP server adicionado ao .mcp.json")
    report.updated.push("~/.mcp.json (headroom)")
  }
}
