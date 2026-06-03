import { createInterface } from "readline"
import { install } from "../installer/install.js"
import { doctor } from "../installer/doctor.js"
import { initCommand } from "../commands/init.js"

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
  console.log(color("\n  ╔══════════════════════════════════════╗", COLORS.cyan))
  console.log(color("  ║      GStack VibeHard Installer       ║", COLORS.cyan))
  console.log(color("  ║    @gstack_vibehard/installer — v0.1.0 ║", COLORS.cyan))
  console.log(color("  ╚══════════════════════════════════════╝\n", COLORS.cyan))
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
  console.log(color("    gstack_vibehard init <nome>    Criar novo projeto com estrutura completa", COLORS.cyan))
  console.log(color("    gstack_vibehard doctor         Diagnosticar ambiente", COLORS.cyan))
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
  logo()

  switch (command) {
    case "install":
      await install()
      break
    case "init":
      await initCommand(args)
      break
    case "doctor":
      await doctor()
      break
    case "uninstall":
      console.log(color("  Uninstall ainda nao implementado.", COLORS.yellow))
      break
    case "list":
      console.log(color("  List ainda nao implementado.", COLORS.yellow))
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
