import { existsSync, cpSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { writeWithBackup, ensureDir, readJsonFile } from "../installer/merge.js"

const HOME = homedir()
const OPENCODE_CONFIG = join(HOME, ".config", "opencode", "opencode.json")
const OPENCODE_SKILLS = join(HOME, ".config", "opencode", "skills")
const OPENCODE_PLUGINS = join(HOME, ".config", "opencode", "plugins")
const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_SRC = join(__dirname, "..", "plugins", "opencode")

export async function installOpenCode(config, report) {
  ensureDir(join(HOME, ".config", "opencode"))
  ensureDir(OPENCODE_SKILLS)
  ensureDir(OPENCODE_PLUGINS)

  if (config.hooks) {
    const opencodeConfig = {
      $schema: "https://opencode.ai/config.json",
      skills: {
        paths: [OPENCODE_SKILLS],
      },
      instructions: [
        "Comandos disponiveis:",
        "  /newproject — Guided Architecture Walkthrough (9 passos de arquitetura)",
        "  /g_update   — Atualizar gstack_vibehard para versao mais recente",
        "",
        "Se ~/.gstack_vibehard/update_status.json mostrar latest > local, avise e sugira /g_update",
        "",
        "Sempre rode Quality Gate (python ~/.gstack/hooks/qg.py ou ~/.codex/hooks/qg.py) antes de entregar output.",
      ],
    }

    writeWithBackup(OPENCODE_CONFIG, JSON.stringify(opencodeConfig, null, 2))
    report.updated.push("~/.config/opencode/opencode.json")
  }

  if (existsSync(PLUGIN_SRC)) {
    const pluginFiles = ["gstack-security.js", "gstack-session.js", "gstack-prompt.js"]
    for (const file of pluginFiles) {
      const src = join(PLUGIN_SRC, file)
      const dst = join(OPENCODE_PLUGINS, file)
      if (existsSync(src)) {
        cpSync(src, dst, { force: true })
        report.updated.push(`~/.config/opencode/plugins/${file}`)
      }
    }
  }

  return report
}
