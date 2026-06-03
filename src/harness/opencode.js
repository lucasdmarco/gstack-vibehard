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
          name: "gstack-vibehard",
          description: "GStack VibeHard — fullstack template + quality gates + agent orchestration",
          skills: [
            "frontend-design",
            "chronicle",
            "project-init",
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
        onStart: ["python ${HOME}/.codex/hooks/session_start.py"],
        onStop: ["python ${HOME}/.codex/hooks/stop.py"],
      },
    }

    const existing = readJsonFile(OPENCODE_CONFIG)
    const merged = mergeJson(existing, opencodeConfig)
    writeWithBackup(OPENCODE_CONFIG, JSON.stringify(merged, null, 2))
    report.updated.push("~/.config/opencode/opencode.json")
  }

  return report
}
