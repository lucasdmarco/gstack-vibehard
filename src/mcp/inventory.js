import { homedir } from "os"
import { redactSecrets, hasSecret } from "../security/redact.js"
import { readClaudeMcp } from "./readers/claude.js"
import { readCodexMcp } from "./readers/codex.js"
import { readOpenCodeMcp } from "./readers/opencode.js"
import { readProjectMcp } from "./readers/project.js"

/**
 * MCP Inventory multi-harness (PRD14 §4.2/§4.13): lê as configs MCP de Claude,
 * Codex, OpenCode e do projeto, normaliza num schema único e detecta duplicidade/
 * fragmentação entre harnesses.
 *
 * Invariantes de segurança:
 *  - NUNCA emite valor de env — só NOMES de variáveis (`envKeys`/`secretEnvKeys`).
 *  - args/url passam por `redactSecrets` (segredo inline vira ***REDACTED***).
 *  - Config ausente/ilegível NUNCA quebra: vira `{exists:false}`/`{valid:false}`.
 */

export const MCP_SCHEMA_VERSION = "gstack.mcp.v1"

// Nome de env que carrega credencial (mesma família do SECRET_FLAG do executor).
const SECRET_ENV = /(token|key|secret|password|passwd|auth|credential|bearer|cookie)/i

/** Env do servidor: só NOMES saem (detecção roda nos valores, nunca os emite). */
function envInfo(r) {
  const envObj = asObject(r.env) || asObject(r.environment) || {}
  const envKeys = Object.keys(envObj)
  const secretEnvKeys = envKeys.filter((k) => SECRET_ENV.test(k) || hasSecret(String(envObj[k] ?? "")))
  return { envKeys, secretEnvKeys }
}

function asObject(v) {
  return v && typeof v === "object" ? v : null
}

/** command+args (string ou array) → partes redigidas por redactSecrets. */
function commandParts(command, args) {
  const cmd = Array.isArray(command) ? command : (command ? [String(command)] : [])
  const rest = Array.isArray(args) ? args : []
  return [...cmd, ...rest].map((a) => redactSecrets(String(a)))
}

/** URL redigida (define o transport: com url = remote, sem = stdio). */
function urlInfo(url) {
  if (!url) return { transport: "stdio", url: null, urlSecrets: 0 }
  const r = redactSecrets(String(url))
  return { transport: "remote", url: r.redacted, urlSecrets: r.count }
}

/** Comando/URL redigidos (segredo inline vira ***REDACTED*** e liga o flag). */
function launchInfo(r) {
  const parts = commandParts(r.command, r.args)
  const u = urlInfo(r.url)
  return {
    transport: u.transport,
    command: parts.length ? parts.map((p) => p.redacted).join(" ") : null,
    url: u.url,
    hasInlineSecret: parts.some((p) => p.count > 0) || u.urlSecrets > 0,
  }
}

/**
 * Normaliza um servidor cru de qualquer leitor para o shape do schema v1.
 * `raw` pode ter: command (string|array), args, url, env/environment (objeto).
 */
export function normalizeServer({ name, harness, source, raw }) {
  const r = asObject(raw) || {}
  return { name, harness, source, ...launchInfo(r), ...envInfo(r) }
}

/** Executa um leitor sem deixar exceção escapar (leitor quebrado ≠ inventário quebrado). */
function safeRead(reader, ctx) {
  try {
    return reader(ctx)
  } catch (e) {
    return { harness: reader.harnessId || "unknown", sources: [{ path: "(erro no leitor)", exists: false, valid: false, error: String(e.message || e).slice(0, 160) }], servers: [] }
  }
}

/**
 * @param {object} opts { home?, cwd?, readers? } — injetáveis para teste hermético.
 * @returns inventário `gstack.mcp.v1`
 */
export function buildMcpInventory(opts = {}) {
  const ctx = { home: opts.home || homedir(), cwd: opts.cwd || process.cwd() }
  const readers = opts.readers || [readClaudeMcp, readCodexMcp, readOpenCodeMcp, readProjectMcp]
  const results = readers.map((r) => safeRead(r, ctx))

  const servers = results.flatMap((r) => r.servers.map((s) => normalizeServer(s)))
  const sources = results.flatMap((r) => r.sources.map((s) => ({ harness: r.harness, ...s })))

  // Fragmentação: mesmo NOME de servidor declarado em mais de uma fonte —
  // duplicidade real de contexto (o agente vê o tool set duas vezes).
  const byName = new Map()
  for (const s of servers) {
    if (!byName.has(s.name)) byName.set(s.name, [])
    byName.get(s.name).push(s)
  }
  const fragmentation = [...byName.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({
      name,
      count: list.length,
      harnesses: [...new Set(list.map((s) => s.harness))],
      sources: list.map((s) => s.source),
    }))

  const withSecrets = servers.filter((s) => s.secretEnvKeys.length > 0 || s.hasInlineSecret)
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    servers,
    fragmentation,
    sources,
    aggregates: {
      serverCount: servers.length,
      harnessCount: new Set(servers.map((s) => s.harness)).size,
      duplicateServerCount: fragmentation.length,
      serversWithSecrets: withSecrets.length,
    },
  }
}

function renderFragmentation(inv, p) {
  if (inv.fragmentation.length === 0) { p("  ✓ Sem servidores duplicados entre harnesses."); return }
  for (const f of inv.fragmentation) {
    p(`  ⚠ ${f.name} — declarado ${f.count}x (${f.harnesses.join(", ")})`)
    f.sources.forEach((s) => p(`      • ${s}`))
  }
}

function serverLine(s) {
  const sec = s.secretEnvKeys.length ? ` env-secrets:[${s.secretEnvKeys.join(",")}]` : ""
  const inline = s.hasInlineSecret ? " ⚠ segredo inline redigido" : ""
  return `    • ${s.name} [${s.transport}]${sec}${inline}`
}

/** Render humano (o --json imprime o objeto puro; aqui é a visão de gente). */
export function renderInventoryHuman(inv, { fragmentedOnly = false, print = console.log } = {}) {
  const p = print
  if (fragmentedOnly) { renderFragmentation(inv, p); return }
  if (inv.servers.length === 0) p("  (nenhum servidor MCP encontrado nas configs conhecidas)")
  const harnesses = [...new Set(inv.servers.map((s) => s.harness))]
  for (const harness of harnesses) {
    const list = inv.servers.filter((s) => s.harness === harness)
    p(`  ${harness} (${list.length}):`)
    list.forEach((s) => p(serverLine(s)))
  }
  const a = inv.aggregates
  p("")
  p(`  Total: ${a.serverCount} server(s) em ${a.harnessCount} harness(es) · duplicados: ${a.duplicateServerCount} · com secrets: ${a.serversWithSecrets}`)
  if (a.duplicateServerCount > 0) p("  Dica: `tools mcp inventory --fragmented` mostra só a duplicidade.")
}
