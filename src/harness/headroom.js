import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execSync } from "child_process"
import { writeWithBackup, ensureDir, readJsonFile, mergeJson } from "../installer/merge.js"
import { isWindows } from "./detector.js"

const HOME = homedir()
const MCP_CONFIG = join(HOME, ".mcp.json")

export async function installHeadroom(deps, report) {
  const { run, warn, success, info, uvBin } = deps

  info("headroom: Instalando...")

  // Install via pip (prefer uv pip since we have uv)
  let pipCmd = "pip"
  if (uvBin) {
    pipCmd = `${uvBin} pip`
  }

  run(`${pipCmd} install "headroom-ai[proxy]"`, "headroom-ai[proxy]")

  // Verify installation
  try {
    const ver = execSync("headroom --version 2>&1", { stdio: "pipe", timeout: 5000 }).toString().trim()
    success(`headroom: ${ver}`)
    report.added.push("headroom (context compressor)")
  } catch {
    warn("headroom: instalado mas `headroom --version` falhou (PATH talvez)")
  }

  // headroom wrap for supported harnesses
  for (const harnessId of deps.selectedHarnessIds) {
    try {
      switch (harnessId) {
        case "claude":
          execSync("headroom wrap claude 2>&1", { stdio: "pipe", timeout: 30000 })
          success("headroom wrap claude")
          break
        case "codex":
          execSync("headroom wrap codex 2>&1", { stdio: "pipe", timeout: 30000 })
          success("headroom wrap codex")
          break
      }
    } catch {
      info(`headroom wrap ${harnessId}: pulado`)
    }
  }

  // Add headroom to MCP servers
  const mcpSettings = {
    mcpServers: {
      headroom: {
        command: "headroom",
        args: ["mcp"],
      },
    },
  }

  const existing = readJsonFile(MCP_CONFIG)
  const merged = mergeJson(existing, mcpSettings)
  writeWithBackup(MCP_CONFIG, JSON.stringify(merged, null, 2))
  success("headroom MCP server adicionado ao .mcp.json")
  report.updated.push("~/.mcp.json (headroom)")
}
