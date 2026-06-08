import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { writeWithBackup, ensureDir, readJsonFile } from "../installer/merge.js"

const HOME = homedir()

const HOOKS_SOURCE = join(process.cwd(), "hooks", "hooks")
const SKILLS_SOURCE = join(process.cwd(), "skills", "skills")
const TEMPLATE_SOURCE = join(process.cwd(), "templates", "templates")

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
    const skillsDir = join(HOME, ".agents", "skills").replaceAll("\\", "/")
    const hooksDirPosix = hooksDir.replaceAll("\\", "/")
    const tomlContent = `# gstack_vibehard — Codex CLI hooks
[hooks]
on_session_start = ["python ${hooksDirPosix}/session_start.py"]
on_stop = ["python ${hooksDirPosix}/stop.py"]
pre_tool_use = ["python ${hooksDirPosix}/pre_tool_use_security.py"]
post_tool_use = ["python ${hooksDirPosix}/post_tool_use_review.py"]

[agent]
skills_dir = "${skillsDir}"
instructions = """
Comandos disponiveis:
  /newproject — Guided Architecture Walkthrough (10 passos com design system)
  /g_update   — Atualizar gstack_vibehard para versao mais recente

Design System: ANTES de escrever frontend, pergunte se usuario tem DS proprio.
Se nao perguntar, o hook pre_tool_use_security.py vai bloquear a escrita.

Se ~/.gstack_vibehard/update_status.json mostrar latest > local, avise e sugira /g_update
"""

[mcp_servers.fallow]
command = "npx"
args = ["-y", "fallow", "mcp"]

[mcp_servers.supabase]
command = "npx"
args = ["-y", "@supabase/mcp-server", "--project-ref", "${SUPABASE_PROJECT_REF}"]

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp"]

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp", "--api-key", "${CONTEXT7_API_KEY}"]

[mcp_servers.gbrain]
command = "gbrain"
args = ["serve"]

[mcp_servers.graphify]
command = "python"
args = ["-m", "graphify.serve", "graphify-out/graph.json"]

[mcp_servers.headroom]
command = "headroom"
args = ["mcp"]
`
    writeWithBackup(configFile, tomlContent)
    report.updated.push("~/.codex/config.toml")
  }

  return report
}
