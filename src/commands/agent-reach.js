import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import { stripBom } from "../util/json.js"
import { CHANNELS, GROUPS, coreChannels, isSensitive, resolveSelection } from "../tools/agent-reach/catalog.js"
import { success, warn, error, info, section, confirm } from "../cli/index.js"

/**
 * `tools agent-reach` — capability layer de leitura/pesquisa na internet com
 * SELETOR DE CANAIS e consentimento por canal (PRD14 §4.15).
 *
 *   enable                     wizard interativo (TTY); non-TTY exige --core/--channels
 *   enable --core              só canais zero-config
 *   enable --channels a,b      seleção explícita (sensível exige consentimento)
 *   enable --safe              não instala nada; só plano e orientação
 *   enable --dry-run [--json]  preview sem escrita
 *   channels                   lista canais, grupos e requisitos
 *   install-channel <id>       instala/ativa um canal específico
 *   doctor [--json]            estado por canal (active_backend honesto)
 *
 * Regras: nenhum canal cookie/login entra por default; `all` exige --accept-risks;
 * backend externo ausente = external_engine_unavailable (nunca OK falso).
 */

const REGISTRY_WRITES = [".gstack/integrations.json"]
const ROLLBACK = "remova o bloco agentReach de .gstack/integrations.json (nada global é escrito)"

function registryPath(cwd) { return join(cwd, ".gstack", "integrations.json") }

function readRegistry(cwd) {
  try { return JSON.parse(stripBom(readFileSync(registryPath(cwd), "utf-8"))) } catch { return null }
}

function writeAgentReach(cwd, block) {
  const reg = readRegistry(cwd) || {}
  reg.agentReach = block
  writeFileSync(registryPath(cwd), JSON.stringify(reg, null, 2) + "\n")
}

/** Backend externo disponível? (CLI `agent-reach` no PATH — probe honesto) */
export function backendAvailable(exec) {
  try {
    exec("agent-reach", ["--version"], { stdio: "pipe", shell: false, timeout: 5000 })
    return true
  } catch { return false }
}

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n")
  return obj
}

/** Plano de ativação (o contrato do --dry-run): canais, riscos, writes, rollback. */
export function buildPlan(channels, { safe = false, backend = false } = {}) {
  return {
    channels: channels.map((c) => ({
      id: c.id, group: c.group, label: c.label, zeroConfig: c.zeroConfig,
      requires: c.requires, riskNotes: c.riskNotes,
      sensitive: isSensitive(c), consentRequired: isSensitive(c),
    })),
    dependencies: safe ? [] : ["agent-reach CLI (backend externo)"],
    backend: backend ? "available" : "external_engine_unavailable",
    writes: safe ? [] : REGISTRY_WRITES,
    risks: channels.filter(isSensitive).map((c) => `${c.id}: ${c.riskNotes.join("; ")}`),
    rollback: ROLLBACK,
    consentRules: [
      "canal cookie/login nunca entra por default",
      "cookies/tokens nunca em .env/.gstack/logs/journal",
      "'all' exige --accept-risks com efeitos listados",
    ],
  }
}

/** Seleção a partir das flags (sem TTY). null = precisa de wizard/flags. */
function selectionFromFlags(args) {
  if (args.includes("--core")) return { channels: coreChannels(), mode: "core", unknown: [] }
  const ci = args.indexOf("--channels")
  if (ci === -1) return null
  const tokens = []
  for (let i = ci + 1; i < args.length && !String(args[i]).startsWith("--"); i++) {
    tokens.push(...String(args[i]).split(",").map((s) => s.trim()).filter(Boolean))
  }
  const sel = resolveSelection(tokens)
  return { ...sel, mode: tokens.includes("all") ? "all" : "custom" }
}

/** Wizard TTY: core por default, cada canal sensível é perguntado individualmente. */
async function wizardSelection() {
  const picked = [...coreChannels()]
  info("Core zero-config (recomendado): " + picked.map((c) => c.id).join(", "))
  for (const c of CHANNELS.filter((x) => !picked.includes(x))) {
    const risk = isSensitive(c) ? ` [${c.requires.join(", ")}] riscos: ${c.riskNotes.join("; ")}` : ""
    const yes = await confirm(`Ativar ${c.id} (${c.label})?${risk}`, false)
    if (yes) picked.push(c)
  }
  return { channels: picked, mode: "custom", unknown: [] }
}

/** Falha padronizada: JSON puro no --json, mensagem humana caso contrário. */
function refuse(json, out, message, hints = []) {
  if (json) return emitJson(out)
  error(message)
  hints.forEach((h) => info(h))
  return undefined
}

/** Guard: sem seleção em modo não-interativo → needs_channel_selection. */
function guardNoSelection(sel, json) {
  if (sel || process.stdin.isTTY) return null
  return {
    out: refuse(json, { error: "needs_channel_selection", hint: "use --core (zero-config) ou --channels <ids|grupos|all>" },
      "Modo não-interativo: escolha os canais explicitamente.",
      ["  gstack_vibehard tools agent-reach enable --core", "  gstack_vibehard tools agent-reach enable --channels web-reader,youtube"]),
  }
}

/** Guard: `all` sempre exige --accept-risks, listando os efeitos sensíveis. */
function guardAllNeedsRisks(args, sel, json) {
  if (!sel || sel.mode !== "all" || args.includes("--accept-risks")) return null
  const effects = CHANNELS.filter(isSensitive).map((c) => c.id)
  return {
    out: refuse(json, { error: "needs_accept_risks", sensitiveChannels: effects, hint: "repita com --accept-risks após revisar os efeitos" },
      "--channels all inclui canais com cookie/login: " + effects.join(", "),
      ["  Revise os riscos (`agent-reach channels`) e repita com --accept-risks."]),
  }
}

/** Guard: canal sensível em modo não-interativo exige --accept-risks. */
function guardSensitiveNonTty(args, sel, json) {
  if (!sel || sel.mode === "all" || args.includes("--accept-risks") || process.stdin.isTTY) return null
  const sensitive = sel.channels.filter(isSensitive).map((c) => c.id)
  if (!sensitive.length) return null
  return {
    out: refuse(json, { error: "needs_accept_risks", sensitiveChannels: sensitive, hint: "canal cookie/login exige --accept-risks em modo não-interativo" },
      "Canais sensíveis exigem consentimento explícito: " + sensitive.join(", "),
      ["  Repita com --accept-risks para consentir."]),
  }
}

/** Guard: ids/grupos desconhecidos na seleção explícita. */
function guardUnknown(sel, json) {
  if (!sel || !sel.unknown.length) return null
  return { out: refuse(json, { error: "unknown_channels", unknown: sel.unknown }, "Canais desconhecidos: " + sel.unknown.join(", ")) }
}

function enableGuards(args, sel, json) {
  return guardNoSelection(sel, json) || guardUnknown(sel, json) ||
    guardAllNeedsRisks(args, sel, json) || guardSensitiveNonTty(args, sel, json)
}

function renderPreview(plan, safe, json) {
  if (json) return emitJson({ dryRun: true, safe, plan })
  section(`agent-reach enable ${safe ? "--safe" : "--dry-run"} (nada foi ${safe ? "instalado" : "escrito"})`)
  plan.channels.forEach((c) => info(`  ${c.sensitive ? "⚠" : "•"} ${c.id} [${c.group}]${c.sensitive ? " exige " + c.requires.join("/") : ""}`))
  info(`  Backend: ${plan.backend} · writes: ${plan.writes.join(", ") || "(nenhum)"} · rollback: ${plan.rollback}`)
  return { dryRun: true, safe, plan }
}

function persistEnable(cwd, sel) {
  writeAgentReach(cwd, {
    enabled: true, mode: sel.mode,
    channels: sel.channels.map((c) => c.id),
    consented: Object.fromEntries(sel.channels.filter(isSensitive).map((c) => [c.id, new Date().toISOString()])),
    decidedAt: new Date().toISOString(),
  })
}

function renderEnabled(sel, plan, json) {
  const result = { enabled: true, mode: sel.mode, channels: sel.channels.map((c) => c.id), backend: plan.backend }
  if (json) return emitJson(result)
  section("agent-reach enable")
  sel.channels.forEach((c) => success(`  ✓ ${c.id} registrado`))
  if (plan.backend !== "available") warn("  Backend `agent-reach` NÃO encontrado — canais registrados, instalação pendente (external_engine_unavailable).")
  info("  Estado: `gstack_vibehard tools agent-reach doctor` · cookies/tokens NUNCA no repo.")
  return result
}

async function cmdEnable(cwd, args, json, opts) {
  let sel = selectionFromFlags(args)
  const guard = enableGuards(args, sel, json)
  if (guard) return guard.out
  if (!sel) sel = await wizardSelection()
  const safe = args.includes("--safe")
  const plan = buildPlan(sel.channels, { safe, backend: backendAvailable(opts.exec || execFileSync) })
  if (args.includes("--dry-run") || safe) return renderPreview(plan, safe, json)
  persistEnable(cwd, sel)
  return renderEnabled(sel, plan, json)
}

function cmdChannels(json) {
  if (json) return emitJson({ groups: GROUPS, channels: CHANNELS })
  section("agent-reach channels — catálogo e requisitos")
  for (const g of GROUPS) {
    info(`  ${g}:`)
    for (const c of CHANNELS.filter((x) => x.group === g)) {
      const req = c.requires.length ? ` — exige: ${c.requires.join(", ")}` : " — zero-config"
      info(`   ${isSensitive(c) ? "⚠" : "•"} ${c.id}: ${c.label}${req}`)
    }
  }
  info("")
  info("  Default seguro = só core zero-config. Sensível exige consentimento por canal.")
}

async function cmdInstallChannel(cwd, args, json, opts) {
  const id = args.find((a, i) => i > 0 && !a.startsWith("--"))
  const ch = CHANNELS.find((c) => c.id === id)
  if (!ch) {
    if (json) return emitJson({ error: "unknown_channel", id })
    error(`Canal desconhecido: ${id || "(vazio)"} — veja \`agent-reach channels\`.`); return
  }
  return cmdEnable(cwd, ["--channels", ch.id, ...args.filter((a) => a.startsWith("--"))], json, opts)
}

// enabled × backend → status honesto do canal (tabela, não if-chain)
const CHANNEL_STATUS = {
  "on|missing": "backend_missing",
  "off|missing": "not_installed",
  "on|ok": "configured",
  "off|ok": "not_enabled",
}

function isChannelEnabled(reg, id) {
  return Boolean(reg && reg.enabled && (reg.channels || []).includes(id))
}

function channelStatus(id, reg, backend) {
  const enabled = isChannelEnabled(reg, id)
  const key = (enabled ? "on" : "off") + "|" + (backend ? "ok" : "missing")
  return { channel: id, enabled, status: CHANNEL_STATUS[key], active_backend: backend ? "agent-reach" : null }
}

function renderDoctorHuman(report) {
  section("agent-reach doctor")
  info(`  Backend: ${report.backend} · habilitado: ${report.enabled}${report.mode ? ` (${report.mode})` : ""}`)
  const on = report.channels.filter((x) => x.enabled)
  on.forEach((c) => info(`  • ${c.channel}: ${c.status}${c.active_backend ? ` (backend: ${c.active_backend})` : ""}`))
  if (!on.length) info("  (nenhum canal habilitado — `agent-reach enable --core`)")
}

function buildDoctorReport(reg, backend) {
  return {
    backend: backend ? "available" : "external_engine_unavailable",
    enabled: Boolean(reg && reg.enabled),
    mode: reg ? reg.mode : null,
    channels: CHANNELS.map((c) => channelStatus(c.id, reg, backend)),
    note: "verificação fina por canal requer o doctor do próprio backend agent-reach",
  }
}

function cmdDoctor(cwd, json, opts) {
  const reg = (readRegistry(cwd) || {}).agentReach || null
  const report = buildDoctorReport(reg, backendAvailable(opts.exec || execFileSync))
  if (json) return emitJson(report)
  renderDoctorHuman(report)
  return report
}

const SUBCOMMANDS = {
  channels: (ctx) => cmdChannels(ctx.json),
  doctor: (ctx) => cmdDoctor(ctx.cwd, ctx.json, ctx.opts),
  "install-channel": (ctx) => cmdInstallChannel(ctx.cwd, ctx.args.slice(ctx.args.indexOf("install-channel")), ctx.json, ctx.opts),
  enable: (ctx) => cmdEnable(ctx.cwd, ctx.args, ctx.json, ctx.opts),
}

export async function agentReachCommand(args = [], opts = {}) {
  const ctx = { cwd: opts.cwd || process.cwd(), json: args.includes("--json"), args, opts }
  const sub = args.find((a) => !a.startsWith("-")) || "enable"
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(ctx)
  if (ctx.json) return emitJson({ error: "unknown_subcommand", sub })
  section("agent-reach")
  info("  Uso: tools agent-reach enable [--core|--channels a,b|--safe|--dry-run] · channels · install-channel <id> · doctor [--json]")
}
