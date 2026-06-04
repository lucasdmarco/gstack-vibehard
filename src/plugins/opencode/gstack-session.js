import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const HOME = homedir()
const GV_DIR = join(HOME, ".gstack_vibehard")
const GV_STATUS = join(GV_DIR, "update_status.json")
const CWD = process.cwd()

export const GstackSession = async ({ $ }) => {
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
          const local = "0.7.4"
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
