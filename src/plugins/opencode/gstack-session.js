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
        } catch {}
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
        } catch {}
      }
    },

    "session.deleted": async () => {
      try {
        await $`python ${HOME}/.codex/hooks/stop.py`
      } catch {}
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
