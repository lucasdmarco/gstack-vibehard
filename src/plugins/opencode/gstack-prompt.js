import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const HOME = homedir()
const SKILLS_DIR = join(HOME, ".agents", "skills")

const SKILL_MAP = {
  deploy: "deployment",
  "deploy to": "deployment",
  database: "database",
  supabase: "database",
  sql: "database",
  migration: "migrate-to-multi-artifact, database",
  slide: "slides",
  presentation: "slides",
  artifact: "artifacts",
  canvas: "canvas",
  whiteboard: "canvas",
  "object storage": "object-storage",
  upload: "object-storage",
  storage: "object-storage",
  project: "new-project",
  scaffold: "new-project",
  template: "new-project",
  test: "auto-testing",
  playwright: "auto-testing",
  browser: "auto-testing",
  pr: "split-to-prs",
  "pull request": "split-to-prs",
  rule: "create-rule",
  hook: "create-hook",
  workflow: "workflows",
  mockup: "mockup-sandbox, mockup-graduate",
  prototype: "mockup-sandbox",
  figma: "mockup-graduate",
  mcp: "mcp-setup",
  integration: "integrations",
  query: "query-integration-data",
  chart: "slides, query-integration-data",
}

export const GstackPrompt = async () => {
  return {
    "tui.prompt.append": async (input, output) => {
      if (!existsSync(SKILLS_DIR)) return

      const prompt = input?.prompt || input?.text || ""
      if (!prompt) return

      const promptLower = prompt.toLowerCase()
      const hints = new Set()

      for (const [keyword, skills] of Object.entries(SKILL_MAP)) {
        if (promptLower.includes(keyword)) {
          for (const skill of skills.split(", ")) {
            const skillPath = join(SKILLS_DIR, skill, "SKILL.md")
            if (existsSync(skillPath)) {
              hints.add(skill)
            }
          }
        }
      }

      if (hints.size > 0) {
        const hintList = Array.from(hints).join(", ")
        output.appended = `\n[Dica: este prompt parece relacionado às skills: ${hintList}]`
      }
    },
  }
}
