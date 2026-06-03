import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execSync } from "child_process"

const HOME = homedir()

export function checkAlreadyInstalled(harnessIds) {
  const installed = []

  if (harnessIds.includes("codex")) {
    const hookFile = join(HOME, ".codex", "hooks", "qg.py")
    if (existsSync(hookFile)) installed.push("codex")
  }

  if (harnessIds.includes("claude")) {
    const ruleFile = join(HOME, ".claude", "rules", "ultracode.md")
    if (existsSync(ruleFile)) installed.push("claude")
  }

  if (harnessIds.includes("opencode")) {
    const cfgFile = join(HOME, ".config", "opencode", "opencode.json")
    if (existsSync(cfgFile)) {
      try {
        const content = readFileSync(cfgFile, "utf-8")
        if (content.includes("gstack_vibehard")) installed.push("opencode")
      } catch {}
    }
  }

  return installed
}

export function isHeadroomInstalled() {
  try {
    execSync("headroom --version 2>&1", { stdio: "pipe", timeout: 5000 })
    return true
  } catch {
    return false
  }
}
