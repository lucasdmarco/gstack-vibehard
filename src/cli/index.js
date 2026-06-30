import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createInterface } from "readline"
import { execSync } from "child_process"
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
import { runtimeCommand } from "../commands/runtime.js"
import { devCommand, stopCommand, logsCommand, openCommand } from "../commands/runtime-supervisor.js"
import { secretsCommand } from "../commands/secrets.js"
import { agentsCommand } from "../commands/agents.js"
import { qaCommand } from "../commands/qa.js"
import { auditCommand } from "../commands/audit.js"
import { challengeCommand } from "../commands/challenge.js"
import { orchestrateCommand } from "../commands/orchestrate.js"
import { planCommand } from "../commands/plan.js"
import { startCommand } from "../commands/start.js"
import { taskCommand } from "../commands/task.js"
import { verifyCommand } from "../commands/verify.js"
import { dreamCommand } from "../commands/dream.js"
import { proxyCommand } from "../commands/proxy.js"
import { activateCommand } from "../commands/activate.js"
import { publishGuardCommand } from "../commands/publish-guard.js"
import { updateCommand } from "../commands/update.js"

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

let noColor = !!process.env.NO_COLOR
// ASCII fallback p/ terminais que mojibakean box-drawing/unicode (PowerShell legado).
let asciiMode = process.env.GSTACK_ASCII === "1"

export function setNoColor(v) { noColor = !!v }

let _consoleFixed = false
/**
 * Windows legado (PowerShell 5.1 / conhost) renderiza UTF-8 como mojibake (ex.:
 * `╔`→`ÔòÉ`, `✓`→`Ô£ô`) quando a codepage do console não é 65001. Trocar p/ UTF-8
 * conserta TODO o output DIRETO no console (banner + símbolos), sem refatorar cada
 * caractere. LIMITAÇÃO HONESTA: NÃO conserta `gstack ... | Select-String` no
 * PowerShell — o PS cacheia `[Console]::OutputEncoding` no startup (codepage OEM),
 * e um chcp rodado por SUBPROCESSO não muda esse cache. Para pipe, o usuário roda
 * uma vez na sessão: `[Console]::OutputEncoding=[Text.Encoding]::UTF8`. Por isso
 * só rodamos no render direto (TTY), onde de fato ajuda; sem TTY não há ganho e
 * não mexemos na codepage à toa. Pula terminais já UTF-8 (Windows Terminal/VSCode).
 */
function ensureReadableConsole() {
  if (_consoleFixed) return
  _consoleFixed = true
  if (process.platform !== "win32" || !process.stdout.isTTY) return
  if (process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.WT_PROFILE_ID) return
  try { execSync("chcp 65001", { stdio: "ignore", windowsHide: true }) }
  catch { asciiMode = true } // não deu p/ trocar a codepage → cai no banner ASCII
}

function color(text, ...codes) {
  if (noColor) return text
  return codes.join("") + text + COLORS.reset
}

function logo() {
  const width = 40
  // ASCII quando o terminal não aguenta box-drawing (legado): evita o mojibake.
  const B = asciiMode ? { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", dash: "-" }
    : { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║", dash: "—" }
  const line1 = "GStack VibeHard Installer"
  const line2 = `@gstack-vibehard/installer ${B.dash} v${VERSION}`
  const pad = (text) => {
    const total = width - 2 - text.length
    const left = Math.max(0, Math.floor(total / 2))
    const right = Math.max(0, total - left)
    return B.v + " ".repeat(left) + text + " ".repeat(right) + B.v
  }
  console.log(color(`\n  ${B.tl}${B.h.repeat(width - 2)}${B.tr}`, COLORS.cyan))
  console.log(color(`  ${pad(line1)}`, COLORS.cyan))
  console.log(color(`  ${pad(line2)}`, COLORS.cyan))
  console.log(color(`  ${B.bl}${B.h.repeat(width - 2)}${B.br}\n`, COLORS.cyan))
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

// Registro de comandos — fonte única para help curto, avançado e por-comando.
const COMMANDS = [
  { name: "start", group: "common", desc: "Assistente guiado: objetivo → plano → execução", usage: "gstack_vibehard start" },
  { name: "create", group: "common", desc: "Criar um app (LITE por padrão, escreve só ./<nome>)", usage: "gstack_vibehard create <nome> [--full] [--vault] [--dry-run --json]" },
  { name: "init", group: "common", desc: "Criar projeto com estrutura completa", usage: "gstack_vibehard init <nome>" },
  { name: "status", group: "common", desc: "Ver se o gstack está ativo neste projeto", usage: "gstack_vibehard status" },
  { name: "enable", group: "common", desc: "Ativar o gstack neste projeto (novo já vem ativo)", usage: "gstack_vibehard enable" },
  { name: "disable", group: "common", desc: "Desativar neste projeto (preserva dados)", usage: "gstack_vibehard disable" },
  { name: "doctor", group: "common", desc: "Diagnosticar ambiente", usage: "gstack_vibehard doctor [--json [--strict]] [--impact] [--install-integrity] [--repair-manifest [--yes]] [--package-manager [--fix]]" },
  { name: "verify", group: "common", desc: "Delivery gates por arquétipo", usage: "gstack_vibehard verify [--quick] [--profile full|release] [--agentshield] [--json]" },
  { name: "install", group: "common", desc: "Instalar no ambiente (preflight-first; pede confirmação)", usage: "gstack_vibehard install [--audit-only [--save-report]] [--project-only] [--harness <id>] [--no-global-mcp] [--no-obsidian] [--allow-degraded] [--yes]" },
  { name: "uninstall", group: "common", desc: "Remover (rollback via manifest)", usage: "gstack_vibehard uninstall [--dry-run] [--restore-only] [--resolve-drift] [--legacy-name-cleanup]" },
  { name: "update", group: "common", desc: "Checar/atualizar para a última versão (npm)", usage: "gstack_vibehard update [--run] [--json]" },
  { name: "help", group: "common", desc: "Mostrar ajuda (`help advanced` p/ avançados; `help <cmd>` p/ um comando)", usage: "gstack_vibehard help [comando|advanced]" },
  { name: "plan", group: "advanced", desc: "Gerar plano guiado determinístico", usage: "gstack_vibehard plan \"<objetivo>\" [--json --dry-run --recipe <id>] · plan run|status|explain <id>" },
  { name: "task", group: "advanced", desc: "Loop Engineer: plano + execução em worktree", usage: "gstack_vibehard task \"<pedido>\"  ·  task run [planId] --yes" },
  { name: "publish-guard", group: "advanced", desc: "Check determinístico pré-publish (tree/bump/CHANGELOG/tag/CI)", usage: "gstack_vibehard publish-guard [--json] [--no-ci]" },
  { name: "dream", group: "advanced", desc: "Auditoria promessas-vs-evidência (audit/status)", usage: "gstack_vibehard dream audit|status [--json]" },
  { name: "proxy", group: "advanced", desc: "Proxy de redaction pré-output (opt-in)", usage: "gstack_vibehard proxy [--port N] [--upstream URL]" },
  { name: "tools", group: "advanced", desc: "Integrações: Composio (nuvem) + Printing Press (local)", usage: "gstack_vibehard tools <suggested|list|install|mcp>" },
  { name: "context", group: "advanced", desc: "Context docs (ADR/PRD/plans/research)", usage: "gstack_vibehard context <init|index|status>" },
  { name: "delegate", group: "advanced", desc: "Delegar tarefa ao OpenCode (opt-in, confirmação)", usage: "gstack_vibehard delegate opencode --task \"...\" [--worktree] [--yes]" },
  { name: "workflow", group: "advanced", desc: "Graph runner determinístico", usage: "gstack_vibehard workflow <run|runs|inspect>" },
  { name: "a2a", group: "advanced", desc: "Agent Card A2A (offline, sem servidor)", usage: "gstack_vibehard a2a" },
  { name: "monitor", group: "advanced", desc: "TUI: agentes, tokens, QG, ROI", usage: "gstack_vibehard monitor" },
  { name: "runtime", group: "common", desc: "Runtime do projeto (status do manifest)", usage: "gstack_vibehard runtime status [--json]" },
  { name: "dev", group: "common", desc: "Sobe os serviços do projeto (port alloc + health)", usage: "gstack_vibehard dev [--open] [--json]" },
  { name: "stop", group: "common", desc: "Encerra o runtime (árvore de processos)", usage: "gstack_vibehard stop [--json]" },
  { name: "logs", group: "common", desc: "Logs de um serviço do runtime", usage: "gstack_vibehard logs [serviço] [--follow]" },
  { name: "open", group: "common", desc: "Abre o preview do serviço web", usage: "gstack_vibehard open" },
  { name: "secrets", group: "common", desc: "Broker de segredos (keychain do SO; sem .env)", usage: "gstack_vibehard secrets <doctor|list|set|delete|import|run>" },
  { name: "agents", group: "advanced", desc: "Agent Factory: compila core/knowledge/agents → adapters por harness", usage: "gstack_vibehard agents <build|check|diff|doctor|list|explain>" },
  { name: "qa", group: "advanced", desc: "QA Multi-Lens: lentes determinísticas sobre o diff (eval/any/secret/...)", usage: "gstack_vibehard qa [--strict] [--json]" },
  { name: "audit", group: "advanced", desc: "Provenance/VFA: recibos com hash-chain (verifica ações críticas)", usage: "gstack_vibehard audit <status|inspect|verify|export|doctor> [runId]" },
  { name: "challenge", group: "advanced", desc: "Challenge-Response: exige justificativa antes de ação de alto risco", usage: "gstack_vibehard challenge <classify|evaluate> --intent <i> --target <t> [--scope global]" },
  { name: "orchestrate", group: "advanced", desc: "Meta-Harness: executor em worktree + verifier independente + dupla verificação", usage: "gstack_vibehard orchestrate <planId> [--verify-with <harness>] --yes" },
  { name: "sprint", group: "advanced", desc: "Salvar decisões e atualizar memórias", usage: "gstack_vibehard sprint --save" },
  { name: "list", group: "advanced", desc: "Listar componentes instalados", usage: "gstack_vibehard list" },
]

export function showHelp(mode = "short") {
  console.log(color("  Uso: gstack_vibehard <comando> [opções]   ·   `<comando> --help` p/ detalhes", COLORS.bold))
  console.log("")
  const groups = mode === "advanced" ? ["advanced"] : mode === "full" ? ["common", "advanced"] : ["common"]
  for (const g of groups) {
    console.log(color(g === "common" ? "  Comandos:" : "  Avançados:", COLORS.bold))
    for (const c of COMMANDS.filter((x) => x.group === g)) {
      console.log(color(`    ${c.name.padEnd(14)} ${c.desc}`, COLORS.cyan))
    }
    console.log("")
  }
  if (mode === "short") {
    console.log(color("  Primeira vez? → `gstack_vibehard start`   ·   Avançados → `gstack_vibehard help advanced`", COLORS.dim))
  }
}

export function helpFor(name) {
  const c = COMMANDS.find((x) => x.name === name)
  if (!c) { showHelp("short"); return }
  console.log(color(`  ${c.name} — ${c.desc}`, COLORS.bold))
  console.log("")
  console.log(color(`    ${c.usage}`, COLORS.cyan))
}

export function isKnownCommand(name) { return COMMANDS.some((c) => c.name === name) }

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
  if (args.includes("--ascii")) asciiMode = true
  if (args.includes("--no-color")) noColor = true
  ensureReadableConsole() // Windows legado → console UTF-8 (ou ASCII fallback)
  // Saída-máquina (JSON) precisa de stdout limpo: suprime o banner quando há
  // --json ou em comandos que emitem JSON puro (a2a).
  const quiet = args.includes("--json") || command === "a2a"
  const wantsHelp = args.includes("--help") || args.includes("-h")

  // FIRST-RUN SEGURO + HELP UNIVERSAL: nada que pareça ajuda pode instalar/escrever.
  // no-args, --help/-h, ou `help [topico]` → só ajuda, exit 0, zero escrita.
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    if (!quiet) logo()
    const topic = command === "help" ? args[0] : null
    if (topic === "advanced") showHelp("advanced")
    else if (topic && isKnownCommand(topic)) helpFor(topic)
    else {
      showHelp("short")
      if (command === undefined) { console.log(""); info("Dica: comece por `gstack_vibehard start` (seguro, guiado). Nada é instalado por este comando.") }
    }
    return
  }
  // `<comando> --help` → mostra a ajuda do subcomando e NÃO executa.
  if (wantsHelp) {
    if (!quiet) logo()
    helpFor(command)
    return
  }

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
      await doctor(args)
      break
    case "enable":
      await activateCommand("enable", args)
      break
    case "disable":
      await activateCommand("disable", args)
      break
    case "status":
      await activateCommand("status", args)
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
    case "runtime":
      await runtimeCommand(args, { strict: args.includes("--strict") })
      break
    case "dev":
      await devCommand(args)
      break
    case "stop":
      stopCommand(args)
      break
    case "logs":
      logsCommand(args)
      break
    case "open":
      openCommand(args)
      break
    case "secrets":
      await secretsCommand(args)
      break
    case "agents":
      await agentsCommand(args)
      break
    case "qa":
      qaCommand(args)
      break
    case "audit":
      auditCommand(args)
      break
    case "challenge":
      challengeCommand(args)
      break
    case "orchestrate":
      orchestrateCommand(args)
      break
    case "tools":
    case "pp":
      await toolsCommand(args)
      break
    case "context":
      await contextCommand(args)
      break
    case "start":
      await startCommand(args)
      break
    case "plan":
      await planCommand(args)
      break
    case "task":
      await taskCommand(args)
      break
    case "verify":
      await verifyCommand(args)
      break
    case "publish-guard":
      await publishGuardCommand(args)
      break
    case "update":
      await updateCommand(args)
      break
    case "dream":
      await dreamCommand(args)
      break
    case "proxy":
      await proxyCommand(args)
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
