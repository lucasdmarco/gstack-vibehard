import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { writeWithBackup, ensureDir, readJsonFile, mergeJson } from "../installer/merge.js"

const HOME = homedir()
const OPENCODE_CONFIG = join(HOME, ".config", "opencode", "opencode.json")
const OPENCODE_SKILLS = join(HOME, ".config", "opencode", "skills")

export async function installOpenCode(config, report) {
  ensureDir(join(HOME, ".config", "opencode"))
  ensureDir(OPENCODE_SKILLS)

  if (config.hooks) {
    const opencodeConfig = {
      skills: {
        directories: [OPENCODE_SKILLS],
      },
      plugins: [
        {
          name: "gstack_vibehard",
          description: "gstack_vibehard — fullstack template + quality gates + agent orchestration",
          skills: [
            "frontend-design",
            "chronicle",
            "project-init",
            "newproject",
            "g_update",
          ],
        },
        {
          name: "antigravity-agents",
          description: "20 specialist agents with QG gate enforcement",
          skills: [
            "backend-specialist",
            "frontend-specialist",
            "database-architect",
            "security-auditor",
            "orchestrator",
          ],
        },
      ],
      hooks: {
        onStart: [
          "python ${HOME}/.codex/hooks/session_start.py",
          "python ${HOME}/.codex/hooks/gc.py",
        ],
        onStop: ["python ${HOME}/.codex/hooks/stop.py"],
        preToolUse: ["python ${HOME}/.codex/hooks/pre_tool_use_security.py"],
        postToolUse: ["python ${HOME}/.codex/hooks/post_tool_use_review.py"],
        prePrompt: ["python ${HOME}/.codex/hooks/user_prompt_submit.py"],
      },
      instructions: [
        "Comandos disponiveis:",
        "  /newproject — Guided Architecture Walkthrough (9 passos de arquitetura)",
        "  /g_update   — Atualizar gstack_vibehard para versao mais recente",
        "",
        "Se ~/.gstack_vibehard/update_status.json mostrar latest > local, avise e sugira /g_update",
        "",
        "Sempre rode Quality Gate (python ~/.codex/hooks/qg.py) antes de entregar output.",
      ],
    }

    const existing = readJsonFile(OPENCODE_CONFIG)
    const merged = mergeJson(existing, opencodeConfig)
    writeWithBackup(OPENCODE_CONFIG, JSON.stringify(merged, null, 2))
    report.updated.push("~/.config/opencode/opencode.json")
  }

  return report
}
