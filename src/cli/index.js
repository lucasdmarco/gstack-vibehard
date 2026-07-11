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
import { consultCommand } from "../commands/consult.js"
import { policyCommand } from "../commands/policy.js"
import { stateCommand } from "../commands/state.js"
import { taskCommand } from "../commands/task.js"
import { worktreeCommand } from "../commands/worktree.js"
import { verifyCommand } from "../commands/verify.js"
import { proofCommand } from "../commands/proof.js"
import { skillsCommand } from "../commands/skills.js"
import { actionsCommand } from "../commands/actions.js"
import { onboardingCommand } from "../commands/onboarding.js"
import { visualCommand } from "../commands/visual.js"
import { researchCommand } from "../commands/research.js"
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
const isModernWinTerminal = () => !!(process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.WT_PROFILE_ID)
// Windows Terminal/VSCode já falam UTF-8; só o conhost/PS legado precisa do chcp.
const isLegacyWinConsole = () => process.platform === "win32" && !!process.stdout.isTTY && !isModernWinTerminal()
function ensureReadableConsole() {
  if (_consoleFixed) return
  _consoleFixed = true
  if (!isLegacyWinConsole()) return
  // CM-04 (máquina limpa v3.75): o chcp por subprocesso "deu certo" (exit 0) mas o
  // PS 5.1 REAL continuou renderizando mojibake (`â•”`, `InstalaÃ§Ã£o`). Agora
  // VERIFICAMOS a codepage efetiva — só confiamos em unicode com 65001 CONFIRMADO;
  // qualquer outra coisa cai para ASCII+transliteração (legível sempre > bonito).
  try {
    execSync("chcp 65001", { stdio: "ignore", windowsHide: true })
    const active = execSync("chcp", { encoding: "utf-8", windowsHide: true })
    if (!/65001/.test(String(active))) asciiMode = true
  } catch { asciiMode = true } // não deu p/ trocar/verificar → ASCII seguro
}

// Transliteração ASCII central (CM-04): símbolos unicode → ASCII e acentos →
// letras base. Aplicada em TODO output (via `color()`) quando asciiMode está on —
// nenhum caminho de print escapa, então não existe mojibake parcial.
const ASCII_SYMBOLS = [
  [/[✓✔]/g, "OK"], [/[✗✖]/g, "X"], [/⚠/g, "!"], [/[•·]/g, "*"], [/[▸▶►]/g, ">"],
  [/[→⇒]/g, "->"], [/[—–]/g, "-"], [/[─═]/g, "-"], [/[║│]/g, "|"],
  [/[╔╗╚╝┌┐└┘]/g, "+"], [/[▲]/g, "^"], [/…/g, "..."], [/≠/g, "!="], [/[«»]/g, '"'],
]
export function asciiSafe(text) {
  let s = String(text)
  for (const [re, rep] of ASCII_SYMBOLS) s = s.replace(re, rep)
  // acentos → base (Instalação → Instalacao); remove o que sobrar fora do ASCII.
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "")
  return s.replace(/[^\x00-\x7F]/g, "?")
}
export function setAsciiMode(v) { asciiMode = !!v }

function color(text, ...codes) {
  const t = asciiMode ? asciiSafe(text) : text
  if (noColor) return t
  return codes.join("") + t + COLORS.reset
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
  { name: "start", group: "common", desc: "Assistente guiado: objetivo → consult → plano → skill route → execução", usage: "gstack_vibehard start [\"objetivo\"] [--skills a,b] [--assume-no-existing-model] [--yes] [--dry-run --json]" },
  { name: "consult", group: "common", desc: "Recomendação READ-ONLY: caminho único, preview e rollback (nada é escrito)", usage: "gstack_vibehard consult \"<objetivo>\" [--json]" },
  { name: "create", group: "common", desc: "Criar um app (LITE por padrão, escreve só ./<nome>)", usage: "gstack_vibehard create <nome> [--full] [--vault] [--dry-run --json]" },
  { name: "init", group: "common", desc: "Criar projeto com estrutura completa", usage: "gstack_vibehard init <nome>" },
  { name: "status", group: "common", desc: "Ver se o gstack está ativo neste projeto", usage: "gstack_vibehard status" },
  { name: "enable", group: "common", desc: "Ativar o gstack neste projeto (novo já vem ativo)", usage: "gstack_vibehard enable" },
  { name: "disable", group: "common", desc: "Desativar neste projeto (preserva dados)", usage: "gstack_vibehard disable" },
  { name: "doctor", group: "common", desc: "Diagnosticar ambiente", usage: "gstack_vibehard doctor [node] [--json [--strict]] [--impact] [--conformance] [--candidates] [--ruflo] [--opencode] [--fix opencode [--dry-run|--apply|--restore-jsonc]] [--supply-chain] [--install-integrity] [--repair-manifest [--yes]] [--package-manager [--fix]]" },
  { name: "verify", group: "common", desc: "Delivery gates por arquétipo", usage: "gstack_vibehard verify [--quick] [--profile full|release] [--agentshield] [--json]" },
  { name: "proof", group: "common", desc: "Veredito único: pode publicar/entregar? (verify+dream+readiness+git)", usage: "gstack_vibehard proof [--profile release|full|quick] [--json]" },
  { name: "skills", group: "advanced", desc: "Inventário determinístico das skills (hash/provenance/fase)", usage: "gstack_vibehard skills <catalog|doctor> [--json] [--strict]" },
  { name: "actions", group: "advanced", desc: "Action Kernel: ledger por ação + bench de p95 (checkpoints por ação)", usage: "gstack_vibehard actions <ledger|bench> [--run <id>] [--iters N] [--json]" },
  { name: "onboarding", group: "advanced", desc: "Executor determinístico: roda os setup-*.ps1/.sh e VERIFICA os artefatos", usage: "gstack_vibehard onboarding run [--dir <d>] [--tools all] [--variant express] [--json]" },
  { name: "visual", group: "advanced", desc: "Gate visual EXECUTADO: navegador/screenshot/console/rede/a11y como evidência", usage: "gstack_vibehard visual check --url <endereço> [--run <id>] [--json]" },
  { name: "install", group: "common", desc: "Instalar no ambiente (preflight-first; pede confirmação)", usage: "gstack_vibehard install [--audit-only [--save-report]] [--project-only] [--harness <id>] [--no-global-mcp] [--no-obsidian] [--allow-degraded] [--yes]" },
  { name: "uninstall", group: "common", desc: "Remover (rollback via manifest)", usage: "gstack_vibehard uninstall [--dry-run] [--restore-only] [--resolve-drift] [--legacy-name-cleanup]" },
  { name: "update", group: "common", desc: "Checar/atualizar para a última versão (npm)", usage: "gstack_vibehard update [--run] [--json]" },
  { name: "help", group: "common", desc: "Mostrar ajuda (`help advanced` p/ avançados; `help <cmd>` p/ um comando)", usage: "gstack_vibehard help [comando|advanced]" },
  { name: "plan", group: "advanced", desc: "Gerar plano guiado determinístico", usage: "gstack_vibehard plan \"<objetivo>\" [--json --dry-run --recipe <id>] · plan run|status|explain <id>" },
  { name: "task", group: "advanced", desc: "Loop Engineer: plano + execução em worktree", usage: "gstack_vibehard task \"<pedido>\"  ·  task run [planId] --yes" },
  { name: "worktree", group: "advanced", desc: "Lifecycle de worktrees: estados, diff, accept (verify), cleanup seguro", usage: "gstack_vibehard worktree <list|inspect|diff|accept|discard|cleanup> [id] [--dry-run] [--force] [--json]" },
  { name: "publish-guard", group: "advanced", desc: "Check determinístico pré-publish (tree/bump/CHANGELOG/tag/CI)", usage: "gstack_vibehard publish-guard [--json] [--no-ci]" },
  { name: "dream", group: "advanced", desc: "Auditoria promessas-vs-evidência (audit/status)", usage: "gstack_vibehard dream audit|status [--json]" },
  { name: "proxy", group: "advanced", desc: "Proxy de redaction pré-output (opt-in) + cobertura honesta do guard", usage: "gstack_vibehard proxy [--port N] [--upstream URL] · proxy status [--json]" },
  { name: "tools", group: "advanced", desc: "Integrações: Composio (nuvem) + Printing Press (local)", usage: "gstack_vibehard tools <suggested|list|install|mcp>" },
  { name: "context", group: "advanced", desc: "Context docs + scout read-only (paths+linhas, local-first, sem dump)", usage: "gstack_vibehard context <init|index|scout|search|related|explain|status>" },
  { name: "delegate", group: "advanced", desc: "Delegar tarefa a OpenCode ou Devin (opt-in, worktree, verify, provenance)", usage: "gstack_vibehard delegate <opencode|devin> --task \"...\" [--model M] [--worktree] [--cloud-handoff] [--yes]" },
  { name: "policy", group: "advanced", desc: "Policy DSL cross-harness (.gstack/policy.json): deny>allow>ask>default, compila por harness com nível honesto", usage: "gstack_vibehard policy <init|show|eval|compile|doctor> [--harness X] [--json]" },
  { name: "workflow", group: "advanced", desc: "Graph runner determinístico", usage: "gstack_vibehard workflow <run|runs|inspect>" },
  { name: "a2a", group: "advanced", desc: "Agent Card A2A (offline, sem servidor)", usage: "gstack_vibehard a2a" },
  { name: "state", group: "advanced", desc: "State Store operacional do projeto (resumo por entidade)", usage: "gstack_vibehard state summary [--json]" },
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
  { name: "orchestrate", group: "advanced", desc: "Meta-Harness v2: executor em worktree + verifier independente + reviewer plugável (advisory) + paralelismo", usage: "gstack_vibehard orchestrate <planId> [--verify-with <harness>] [--reviewer opencode|claude] [--parallel <n>] --yes" },
  { name: "sprint", group: "advanced", desc: "Salvar decisões e atualizar memórias", usage: "gstack_vibehard sprint --save" },
  { name: "list", group: "advanced", desc: "Listar componentes instalados", usage: "gstack_vibehard list" },
]

const helpGroups = (mode) => (mode === "advanced" ? ["advanced"] : mode === "full" ? ["common", "advanced"] : ["common"])
function printHelpGroup(g) {
  console.log(color(g === "common" ? "  Comandos:" : "  Avançados:", COLORS.bold))
  for (const c of COMMANDS.filter((x) => x.group === g)) console.log(color(`    ${c.name.padEnd(14)} ${c.desc}`, COLORS.cyan))
  console.log("")
}
export function showHelp(mode = "short") {
  console.log(color("  Uso: gstack_vibehard <comando> [opções]   ·   `<comando> --help` p/ detalhes", COLORS.bold))
  console.log("")
  for (const g of helpGroups(mode)) printHelpGroup(g)
  if (mode === "short") console.log(color("  Primeira vez? → `gstack_vibehard start`   ·   Avançados → `gstack_vibehard help advanced`", COLORS.dim))
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

const isHelpInvocation = (command) => command === undefined || command === "--help" || command === "-h" || command === "help"
const isQuiet = (command, args) => args.includes("--json") || command === "a2a"
const wantsHelp = (args) => args.includes("--help") || args.includes("-h")
// `help [topico]`: advanced, um comando conhecido, ou o resumo curto.
function showTopicHelp(command, args) {
  const topic = command === "help" ? args[0] : null
  if (topic === "advanced") return showHelp("advanced")
  if (topic && isKnownCommand(topic)) return helpFor(topic)
  showHelp("short")
  if (command === undefined) { console.log(""); info("Dica: comece por `gstack_vibehard start` (seguro, guiado). Nada é instalado por este comando.") }
}
async function runDispatch(command, args) {
  try { await dispatch(command, args) }
  catch (e) {
    error(`Falha ao executar '${command}': ${e.message}`)
    if (process.env.GSTACK_DEBUG) console.error(e.stack)
    process.exit(1)
  }
}
export async function runCLI(command, args) {
  if (args.includes("--ascii")) asciiMode = true
  if (args.includes("--no-color")) noColor = true
  ensureReadableConsole() // Windows legado → console UTF-8 (ou ASCII fallback)
  // Saída-máquina (JSON/a2a) suprime o banner p/ stdout limpo. Todos os ramos
  // imprimem o logo sob a mesma condição, então o gate é único aqui.
  const quiet = isQuiet(command, args)
  if (!quiet) logo()
  // FIRST-RUN SEGURO + HELP UNIVERSAL: nada que pareça ajuda pode instalar/escrever.
  if (isHelpInvocation(command)) return showTopicHelp(command, args)
  if (wantsHelp(args)) return helpFor(command) // `<comando> --help` → não executa
  await runDispatch(command, args)
}

// Registro de comandos → handler. Fonte única do dispatch (sem switch gigante).
const DISPATCH = {
  install: (a) => install(a),
  create: (a) => createCommand(a),
  init: (a) => initCommand(a),
  doctor: (a) => doctor(a),
  enable: (a) => activateCommand("enable", a),
  disable: (a) => activateCommand("disable", a),
  status: (a) => activateCommand("status", a),
  uninstall: (a) => uninstall(a),
  sprint: (a) => sprintCommand(a),
  list: () => list(),
  monitor: () => monitorCommand(),
  runtime: (a) => runtimeCommand(a, { strict: a.includes("--strict") }),
  dev: (a) => devCommand(a),
  stop: (a) => stopCommand(a),
  logs: (a) => logsCommand(a),
  open: (a) => openCommand(a),
  secrets: (a) => secretsCommand(a),
  agents: (a) => agentsCommand(a),
  qa: (a) => qaCommand(a),
  audit: (a) => auditCommand(a),
  challenge: (a) => challengeCommand(a),
  orchestrate: (a) => orchestrateCommand(a),
  tools: (a) => toolsCommand(a),
  pp: (a) => toolsCommand(a),
  context: (a) => contextCommand(a),
  start: (a) => startCommand(a),
  consult: (a) => consultCommand(a),
  policy: (a) => policyCommand(a),
  state: (a) => stateCommand(a),
  plan: (a) => planCommand(a),
  task: (a) => taskCommand(a),
  worktree: (a) => worktreeCommand(a),
  verify: (a) => verifyCommand(a),
  proof: (a) => proofCommand(a),
  skills: (a) => skillsCommand(a),
  actions: (a) => actionsCommand(a),
  onboarding: (a) => onboardingCommand(a),
  visual: (a) => visualCommand(a),
  research: (a) => researchCommand(a),
  "publish-guard": (a) => publishGuardCommand(a),
  update: (a) => updateCommand(a),
  dream: (a) => dreamCommand(a),
  proxy: (a) => proxyCommand(a),
  delegate: (a) => delegateCommand(a),
  workflow: (a) => workflowCommand(a),
  a2a: (a) => a2aCommand(a),
  help: () => showHelp(),
}

async function dispatch(command, args) {
  const handler = DISPATCH[command]
  if (!handler) {
    console.log(color(`  Comando desconhecido: ${command}`, COLORS.red))
    showHelp()
    process.exit(1)
  }
  await handler(args)
}
