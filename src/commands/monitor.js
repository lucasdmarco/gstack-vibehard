import { existsSync, readFileSync, readdirSync } from "fs"
import { join, resolve } from "path"
import { homedir } from "os"
import { execSync, execFileSync } from "child_process"
import { createInterface } from "readline"

const HOME = resolve(homedir() || process.env.USERPROFILE || process.env.HOME || "/tmp")
const REFRESH_INTERVAL = 5000

function color(text, code) {
  return code + text + "\x1b[0m"
}
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
}

function getAtomicViews() {
  const atomicDir = join(HOME, ".atomic")
  if (!existsSync(atomicDir)) return []
  try {
    const result = execFileSync("atomic", ["list-views"], { stdio: "pipe", timeout: 5000, encoding: "utf-8" })
    return result.trim().split("\n").filter(Boolean).map((l) => {
      const parts = l.split(/\s{2,}/)
      return { name: parts[0] || l, status: parts[1] || "active" }
    })
  } catch {
    return [{ name: "default", status: "active" }]
  }
}

function gstackPath(sub) {
  const primary = join(HOME, ".gstack", sub)
  if (existsSync(primary)) return primary
  return join(HOME, ".codex", sub)
}

function getQGBlockedCount() {
  const chronicleDir = gstackPath("chronicle")
  if (!existsSync(chronicleDir)) return 0
  let count = 0
  try {
    const files = readdirSync(chronicleDir).filter((f) => f.endsWith(".md")).slice(-20)
    for (const f of files) {
      const content = readFileSync(join(chronicleDir, f), "utf-8")
      if (content.includes("QUALITY GATE BLOQUEADO") || content.includes("DEPLOY BLOQUEADO")) {
        count++
      }
    }
  } catch (e) {
    console.warn(`monitor: erro ao ler chronicle QG: ${e.message || e}`)
  }
  return count
}

function getTokenBudget() {
  try {
    const result = execFileSync("ecc2", ["daemon", "status"], { stdio: "pipe", timeout: 3000, encoding: "utf-8" })
    const match = result.match(/tokens[:\s]+(\d+)/i)
    if (match) return parseInt(match[1], 10)
    return 128000
  } catch {
    return 128000
  }
}

function getHarnessStatus() {
  const harnesses = [
    { id: "claude", dir: join(HOME, ".claude") },
    { id: "gstack", dir: join(HOME, ".gstack") },
    { id: "codex", dir: join(HOME, ".codex") },
    { id: "opencode", dir: join(HOME, ".config", "opencode") },
    { id: "cursor", dir: join(HOME, ".cursor") },
    { id: "windsurf", dir: join(HOME, ".codeium", "windsurf") },
  ]
  return harnesses.map((h) => ({
    ...h,
    active: existsSync(join(h.dir, "hooks.json")) || existsSync(h.dir),
  }))
}

function getFallowSummary() {
  try {
    const result = execFileSync("npx", ["fallow", "audit", "--format", "json"], { stdio: "pipe", timeout: 10000, encoding: "utf-8" })
    const data = JSON.parse(result)
    const issues = data.issues || data.findings || []
    return {
      total: issues.length,
      blocking: issues.filter((i) => !i.auto_fixable && (i.severity || "").toUpperCase() in { CRITICO: 1, ALTO: 1 }).length,
      autoFixable: issues.filter((i) => i.auto_fixable).length,
    }
  } catch {
    return { total: 0, blocking: 0, autoFixable: 0 }
  }
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H")
}

function render() {
  clearScreen()
  const harnesses = getHarnessStatus()
  const views = getAtomicViews()
  const qgBlocked = getQGBlockedCount()
  const tokenBudget = getTokenBudget()
  const fallow = getFallowSummary()

  console.log(color("╔══════════════════════════════════════════════════╗", C.cyan))
  console.log(color("║        GStack VibeHard — Monitor TUI           ║", C.cyan))
  console.log(color("╚══════════════════════════════════════════════════╝", C.cyan))

  // Harness Agents
  console.log(color("\n── Harnesses Ativos ──", C.bold))
  for (const h of harnesses) {
    const icon = h.active ? color("●", C.green) : color("○", C.dim)
    console.log(`  ${icon} ${h.id}`)
  }

  // Atomic Views
  console.log(color("\n── Atomic VCS Views ──", C.bold))
  if (views.length === 0) {
    console.log(color(`  (nenhuma view ativa)`, C.dim))
  } else {
    for (const v of views) {
      const statusColor = v.status === "active" ? C.green : v.status === "stale" ? C.yellow : C.red
      console.log(`  ${color("●", statusColor)} ${v.name} [${v.status}]`)
    }
  }

  // Token Budget
  console.log(color("\n── Token Budget ──", C.bold))
  const budgetColor = tokenBudget > 100000 ? C.green : tokenBudget > 50000 ? C.yellow : C.red
  console.log(`  ${color(tokenBudget.toLocaleString(), budgetColor)} tokens restantes (ECC 2.0)`)

  // Quality Gate
  console.log(color("\n── Quality Gate ──", C.bold))
  if (qgBlocked === 0 && fallow.blocking === 0) {
    console.log(color(`  ● Nenhum bloqueio ativo`, C.green))
  } else {
    if (qgBlocked > 0) console.log(color(`  ● ${qgBlocked} chronicle(s) com bloqueio`, C.red))
    if (fallow.blocking > 0) console.log(color(`  ● ${fallow.blocking} bloqueio(s) Fallow`, C.red))
    if (fallow.autoFixable > 0) console.log(color(`  ○ ${fallow.autoFixable} auto-fixavel(is) Fallow`, C.yellow))
    console.log(`  ${fallow.total} issues total (Fallow)`)
  }

  // ROI quick summary (from last post_sprint)
  const sprintDir = gstackPath("sprints")
  if (existsSync(sprintDir)) {
    const sprintFiles = readdirSync(sprintDir).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 1)
    if (sprintFiles.length > 0) {
      try {
        const roi = JSON.parse(readFileSync(join(sprintDir, sprintFiles[0]), "utf-8"))
        console.log(color("\n── Ultimo Sprint (ROI) ──", C.bold))
        if (roi.tokens_saved) console.log(`  Tokens salvos: ${roi.tokens_saved.toLocaleString()}`)
        if (roi.fallow_blocks !== undefined) console.log(`  Injeções barradas: ${roi.fallow_blocks}`)
        if (roi.files_modified !== undefined) console.log(`  Arquivos modificados: ${roi.files_modified}`)
      } catch (e) {
        console.warn(`monitor: erro ao ler sprint ROI: ${e.message || e}`)
      }
    }
  }

  console.log(color("\n──────────────────────────────", C.dim))
  console.log(color(`Pressione Ctrl+C para sair (refresh a cada ${REFRESH_INTERVAL/1000}s)`, C.dim))
}

let interval = null

export async function monitorCommand() {
  render()
  interval = setInterval(render, REFRESH_INTERVAL)

  if (process.platform === "win32") {
    process.on("SIGINT", () => {
      if (interval) clearInterval(interval)
      process.stdout.write("\n")
      process.exit(0)
    })
  } else {
    const rl = createInterface({ input: process.stdin })
    rl.on("SIGINT", () => {
      if (interval) clearInterval(interval)
      rl.close()
      process.stdout.write("\n")
      process.exit(0)
    })
  }
}

