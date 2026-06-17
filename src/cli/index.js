import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createInterface } from "readline"
import { install } from "../installer/install.js"
import { doctor } from "../installer/doctor.js"
import { uninstall, list } from "../installer/uninstall.js"
import { toolsCommand } from "../commands/tools.js"
import { contextCommand } from "../commands/context.js"
import { delegateCommand } from "../commands/delegate.js"
import { workflowCommand } from "../commands/workflow.js"
import { a2aCommand } from "../commands/a2a.js"
import { createCommand } from "./create.js"
import { initCommand } from "../commands/init.js"
import { sprintCommand } from "../commands/sprint.js"
import { monitorCommand } from "../commands/monitor.js"
import { planCommand } from "../commands/plan.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"))
const VERSION = pkg.version

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
}

function color(text, ...codes) {
  return codes.join("") + text + COLORS.reset
}

function logo() {
  const width = 40
  const line1 = "GStack VibeHard Installer"
  const line2 = `@gstack-vibehard/installer — v${VERSION}`
  const pad = (text) => {
    const total = width - 2 - text.length
    const left = Math.max(0, Math.floor(total / 2))
    const right = Math.max(0, total - left)
    return "║" + " ".repeat(left) + text + " ".repeat(right) + "║"
  }
  console.log(color(`\n  ╔${"═".repeat(width - 2)}╗`, COLORS.cyan))
  console.log(color(`  ${pad(line1)}`, COLORS.cyan))
  console.log(color(`  ${pad(line2)}`, COLORS.cyan))
  console.log(color(`  ╚${"═".repeat(width - 2)}╝\n`, COLORS.cyan))
}

export function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(color(`  ? ${question} `, COLORS.yellow), (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export async function confirm(question, defaultValue = true) {
  const hint = defaultValue ? "(Y/n)" : "(y/N)"
  const answer = await prompt(`${question} ${hint}`)
  if (answer === "") return defaultValue
  return answer.toLowerCase() === "y"
}

export async function select(question, options) {
  console.log(color(`\n  ? ${question}`, COLORS.yellow))
  options.forEach((opt, i) => {
    console.log(color(`    ${i + 1}. ${opt}`, COLORS.dim))
  })
  const answer = await prompt(`Escolha (1-${options.length})`)
  const idx = parseInt(answer, 10) - 1
  if (idx >= 0 && idx < options.length) return options[idx]
  console.log(color(`  Opcao invalida. Usando: ${options[0]}`, COLORS.red))
  return options[0]
}

export async function multiSelect(question, options) {
  console.log(color(`\n  ? ${question} (separados por virgula, ex: 1,3,5)`, COLORS.yellow))
  options.forEach((opt, i) => {
    console.log(color(`    ${i + 1}. ${opt.label}`, opt.checked ? COLORS.green : COLORS.dim))
  })
  const answer = await prompt("Escolha")
  if (!answer.trim()) return options.filter((o) => o.checked).map((o) => o.value)
  const indices = answer.split(",").map((s) => parseInt(s.trim(), 10) - 1)
  return indices.filter((i) => i >= 0 && i < options.length).map((i) => options[i].value)
}

export function showHelp() {
  logo()
  console.log(color("  Comandos:", COLORS.bold))
  console.log(color("    gstack_vibehard install        Instalar gstack_vibehard no ambiente", COLORS.cyan))
  console.log(color("      --skip-deps                  Pular instalacao de deps globais (bun, Rust...)", COLORS.dim))
  console.log(color("    gstack_vibehard plan \"<objetivo>\" Gerar plano guiado (determinístico) — modo leve/completo", COLORS.cyan))
  console.log(color("      --name <p> --mode lite|full --json --dry-run --recipe <id>", COLORS.dim))
  console.log(color("      plan run <id> [--yes] · plan status <id> · plan explain <id>", COLORS.dim))
  console.log(color("    gstack_vibehard create <nome>  Criar workspace runtime omniharness", COLORS.cyan))
  console.log(color("    gstack_vibehard init <nome>    Criar novo projeto com estrutura completa", COLORS.cyan))
  console.log(color("    gstack_vibehard doctor         Diagnosticar ambiente", COLORS.cyan))
  console.log(color("    gstack_vibehard sprint --save   Salvar decisoes e atualizar memorias", COLORS.cyan))
  console.log(color("    gstack_vibehard monitor        TUI: agentes, tokens, QG, ROI", COLORS.cyan))
  console.log(color("    gstack_vibehard tools          Integracoes: Composio (nuvem) + Printing Press (local)", COLORS.cyan))
  console.log(color("    gstack_vibehard context        Context docs (ADR/PRD/plans/research) — init/status", COLORS.cyan))
  console.log(color("    gstack_vibehard delegate       Delegar tarefa ao OpenCode (opt-in, confirmação)", COLORS.cyan))
  console.log(color("    gstack_vibehard workflow       Graph runner determinístico — run/runs/inspect", COLORS.cyan))
  console.log(color("    gstack_vibehard a2a            Agent Card A2A (offline, sem servidor)", COLORS.cyan))
  console.log(color("    gstack_vibehard uninstall      Remover gstack_vibehard do ambiente", COLORS.cyan))
  console.log(color("    gstack_vibehard list           Listar componentes instalados", COLORS.cyan))
  console.log(color("    gstack_vibehard help           Mostrar esta ajuda\n", COLORS.cyan))
}

export function success(msg) {
  console.log(color(`  ✓ ${msg}`, COLORS.green))
}

export function warn(msg) {
  console.log(color(`  ⚠ ${msg}`, COLORS.yellow))
}

export function error(msg) {
  console.log(color(`  ✗ ${msg}`, COLORS.red))
}

export function info(msg) {
  console.log(color(`  ${msg}`, COLORS.dim))
}

export function section(title) {
  console.log(`\n${color(`  ── ${title}`, COLORS.bold)}`)
}

export async function runCLI(command, args) {
  // Saída-máquina (JSON) precisa de stdout limpo: suprime o banner quando há
  // --json ou em comandos que emitem JSON puro (a2a).
  const quiet = args.includes("--json") || command === "a2a"
  if (!quiet) logo()

  try {
    await dispatch(command, args)
  } catch (e) {
    error(`Falha ao executar '${command}': ${e.message}`)
    if (process.env.GSTACK_DEBUG) console.error(e.stack)
    process.exit(1)
  }
}

async function dispatch(command, args) {
  switch (command) {
    case "install":
      await install(args)
      break
    case "create":
      await createCommand(args)
      break
    case "init":
      await initCommand(args)
      break
    case "doctor":
      await doctor()
      break
    case "uninstall":
      await uninstall(args)
      break
    case "sprint":
      await sprintCommand(args)
      break
    case "list":
      await list()
      break
    case "monitor":
      await monitorCommand()
      break
    case "tools":
    case "pp":
      await toolsCommand(args)
      break
    case "context":
      await contextCommand(args)
      break
    case "plan":
      await planCommand(args)
      break
    case "delegate":
      await delegateCommand(args)
      break
    case "workflow":
      await workflowCommand(args)
      break
    case "a2a":
      await a2aCommand(args)
      break
    case "help":
      showHelp()
      break
    default:
      console.log(color(`  Comando desconhecido: ${command}`, COLORS.red))
      showHelp()
      process.exit(1)
  }
}
