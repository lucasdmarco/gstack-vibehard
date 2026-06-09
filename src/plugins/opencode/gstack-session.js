async function resolvePythonCmd() {
  try {
    const { execFileSync } = await import("child_process")
    execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 5000 })
    return "python3"
  } catch {
    return "python"
  }
}

export const GstackSession = async ({ $ }) => {
  const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")
  const HOME = homedir()
  const GV_DIR = join(HOME, ".gstack_vibehard")
  const GV_STATUS = join(GV_DIR, "update_status.json")

  return {
    "session.created": async () => {
      if (!existsSync(GV_DIR)) mkdirSync(GV_DIR, { recursive: true })

      const now = Date.now()
      let status = {}
      if (existsSync(GV_STATUS)) {
        try {
          status = JSON.parse(readFileSync(GV_STATUS, "utf-8"))
        } catch (e) {
          console.warn(`gstack-session: erro ao ler update_status: ${e.message || e}`)
        }
      }

      const lastCheck = status.checked_at || 0
      if (now - lastCheck > 86400000) {
        try {
          const result = await $`npm view @gstack-vibehard/installer version`
          const latest = result.stdout?.toString().trim() || "unknown"
          const local = await getLocalVersion($)
          if (latest !== "unknown" && latest !== local) {
            status = { latest, local, checked_at: now, has_update: true }
          } else {
            status = { latest, local, checked_at: now, has_update: false }
          }
          writeFileSync(GV_STATUS, JSON.stringify(status, null, 2), "utf-8")
        } catch (e) {
          console.warn(`gstack-session: erro ao checar update: ${e.message || e}`)
        }
      }
    },

    "session.deleted": async () => {
      try {
        const { execFileSync } = await import("child_process")
        const pyCmd = await resolvePythonCmd()
        const hooksDir = existsSync(join(HOME, ".gstack", "hooks"))
          ? join(HOME, ".gstack", "hooks")
          : join(HOME, ".codex", "hooks")
        const stopPy = join(hooksDir, "stop.py")
        const payload = JSON.stringify({
          cwd: process.cwd(),
          transcript_path: process.env.OPENCODE_TRANSCRIPT_PATH || "",
          last_assistant_message: process.env.OPENCODE_LAST_MESSAGE || "",
        })
        execFileSync(pyCmd, [stopPy], {
          input: payload,
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        })
      } catch (e) {
        console.warn(`gstack-session: erro ao executar stop.py: ${e.message || e}`)
      }
    },
  }
}

async function getLocalVersion($) {
  try {
    const result = await $`npm list -g @gstack-vibehard/installer --depth=0`
    const out = result.stdout?.toString().trim() || ""
    if (out.includes("@")) return out.split("@").pop()?.trim() || "0.0.0"
    return "0.0.0"
  } catch {
    try {
      const result = await $`gstack_vibehard --version`
      return result.stdout?.toString().trim() || "0.0.0"
    } catch {
      return "0.0.0"
    }
  }
}
