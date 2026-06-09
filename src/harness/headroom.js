import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execFileSync } from "child_process"
import { writeWithBackup, ensureDir, readJsonFile, mergeJson } from "../installer/merge.js"
import { isWindows } from "./detector.js"

const HOME = homedir()
const MCP_CONFIG = join(HOME, ".mcp.json")

async function installHeadroomPkg(warn, info, uvBin) {
  const attempts = [
    { label: "headroom-ai[proxy] (latest)", pkg: "headroom-ai[proxy]" },
    { label: "headroom-ai[proxy]==0.20.15 (wheel)", pkg: "headroom-ai[proxy]==0.20.15" },
    { label: "headroom-ai==0.20.15 (wheel, sem extras)", pkg: "headroom-ai==0.20.15" },
  ]

  for (const attempt of attempts) {
    try {
      if (uvBin) {
        execFileSync(uvBin, ["pip", "install", "--system", attempt.pkg], { stdio: "pipe", timeout: 120000, shell: false })
      } else {
        execFileSync("pip", ["install", "--break-system-packages", attempt.pkg], { stdio: "pipe", timeout: 120000, shell: false })
      }
      return true
    } catch (e) {
      info(`headroom: ${attempt.label} — falhou (${e.message || e}), tentando proxima...`)
    }
  }

  // Last ditch: try with uv even if uvBin was empty
  if (!uvBin) {
    try {
      execFileSync("uv", ["pip", "install", "--system", "headroom-ai==0.20.15"], { stdio: "pipe", timeout: 120000, shell: false })
      return true
    } catch (e) {
      info(`headroom: uv fallback — falhou (${e.message || e})`)
    }
  }

  return false
}

export async function installHeadroom(deps, report) {
  const { run, warn, success, info, uvBin } = deps

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

  // headroom wrap for supported harnesses
  for (const harnessId of deps.selectedHarnessIds) {
    try {
      switch (harnessId) {
        case "claude":
          execFileSync("headroom", ["wrap", "claude"], { stdio: "pipe", timeout: 30000, shell: false })
          success("headroom wrap claude")
          break
        case "codex":
          execFileSync("headroom", ["wrap", "codex"], { stdio: "pipe", timeout: 30000, shell: false })
          success("headroom wrap codex")
          break
      }
    } catch (e) {
      info(`headroom wrap ${harnessId}: pulado (${e.message || e})`)
    }
  }

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
