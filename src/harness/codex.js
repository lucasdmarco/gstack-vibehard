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
    const tomlContent = `# gstack_vibehard — Codex CLI hooks
[hooks]
on_session_start = ["python ${hooksDir.replaceAll("\\", "/")}/session_start.py"]
on_stop = ["python ${hooksDir.replaceAll("\\", "/")}/stop.py"]
pre_tool_use = ["python ${hooksDir.replaceAll("\\", "/")}/pre_tool_use_security.py"]
post_tool_use = ["python ${hooksDir.replaceAll("\\", "/")}/post_tool_use_review.py"]

[agent]
skills_dir = "${join(HOME, ".agents", "skills").replaceAll("\\", "/")}"
instructions = """
Comandos disponiveis:
  /newproject — Guided Architecture Walkthrough (9 passos)
  /g_update   — Atualizar gstack_vibehard para versao mais recente

Se ~/.gstack_vibehard/update_status.json mostrar latest > local, avise e sugira /g_update
"""

[mcp_servers.fallow]
command = "npx"
args = ["-y", "fallow", "mcp"]
`
    writeWithBackup(configFile, tomlContent)
    report.updated.push("~/.codex/config.toml")
  }

  return report
}
