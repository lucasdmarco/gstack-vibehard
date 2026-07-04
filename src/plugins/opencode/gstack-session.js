/**
 * Resolve o `stop.py` do fim de sessão (PRD24 24.1): prefere ~/.gstack/hooks,
 * cai para ~/.codex/hooks. Retorna o caminho OU null (degraded) quando não existe
 * em nenhum dos dois. PURO/injetável (`existsSync`/`join`) → testável sem homedir.
 */
export function resolveStopPy({ home, existsSync, join }) {
  const gstackHooks = join(home, ".gstack", "hooks")
  const codexHooks = join(home, ".codex", "hooks")
  const hooksDir = existsSync(gstackHooks) ? gstackHooks : codexHooks
  const stopPy = join(hooksDir, "stop.py")
  return existsSync(stopPy) ? stopPy : null
}

async function resolvePythonCmd() {
  try {
    const { execFileSync } = await import("child_process")
    execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 5000 })
    return "python3"
  } catch {
    return "python"
  }
}

// stdout de um resultado `$` como string trimada (nunca lança).
const trimOut = (r) => (r && r.stdout ? r.stdout.toString().trim() : "")

// Lê ~/.gstack_vibehard/update_status.json (best-effort; {} se ausente/ilegível).
function readUpdateStatus(existsSync, readFileSync, statusPath) {
  if (!existsSync(statusPath)) return {}
  try {
    return JSON.parse(readFileSync(statusPath, "utf-8"))
  } catch (e) {
    console.warn(`gstack-session: erro ao ler update_status: ${e.message || e}`)
    return {}
  }
}

// Consulta a versão publicada e monta o status (has_update comparando com a local).
async function fetchUpdateStatus($, now) {
  const latest = trimOut(await $`npm view @gstack-vibehard/installer version`) || "unknown"
  const local = await getLocalVersion($)
  return { latest, local, checked_at: now, has_update: latest !== "unknown" && latest !== local }
}

// Checa update no máximo 1x/dia; grava o status. Falha vira warn curto, nunca trava.
async function maybeCheckUpdate($, status, now, writeFileSync, statusPath) {
  if (now - (status.checked_at || 0) <= 86400000) return
  try {
    writeFileSync(statusPath, JSON.stringify(await fetchUpdateStatus($, now), null, 2), "utf-8")
  } catch (e) {
    console.warn(`gstack-session: erro ao checar update: ${e.message || e}`)
  }
}

export const GstackSession = async ({ $ }) => {
  if (process.env.GSTACK_OPENCODE_DISABLE === "1") return {} // kill switch (P0.4)
  const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")
  const HOME = homedir()
  const GV_DIR = join(HOME, ".gstack_vibehard")
  const GV_STATUS = join(GV_DIR, "update_status.json")

  return {
    "session.created": async () => {
      if (!existsSync(GV_DIR)) mkdirSync(GV_DIR, { recursive: true })
      const status = readUpdateStatus(existsSync, readFileSync, GV_STATUS)
      await maybeCheckUpdate($, status, Date.now(), writeFileSync, GV_STATUS)
    },

    "session.deleted": async () => {
      try {
        // Degraded curto (PRD24 24.1): sem stop.py em ~/.gstack/hooks NEM ~/.codex/hooks,
        // não spawna nada (nem python) — reporta e sai (evita stack longa em toda sessão).
        const stopPy = resolveStopPy({ home: HOME, existsSync, join })
        if (!stopPy) {
          console.warn("gstack-session: degraded — stop.py ausente em ~/.gstack/hooks e ~/.codex/hooks (pulei o fechamento)")
          return
        }
        const { execFileSync } = await import("child_process")
        const pyCmd = await resolvePythonCmd()
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

// Extrai a versão de `npm list -g ...` (formato `pkg@x.y.z`) ou null se ausente.
async function versionFromNpmList($) {
  const out = trimOut(await $`npm list -g @gstack-vibehard/installer --depth=0`)
  if (!out.includes("@")) return null
  const v = out.split("@").pop()
  return v ? v.trim() : null
}
// Fallback: `gstack_vibehard --version` (0.0.0 se indisponível).
async function versionFromCli($) {
  try { return trimOut(await $`gstack_vibehard --version`) || "0.0.0" }
  catch { return "0.0.0" }
}
async function getLocalVersion($) {
  try {
    return (await versionFromNpmList($)) || (await versionFromCli($))
  } catch {
    return versionFromCli($)
  }
}
