import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs"
import { join } from "path"
import { redactSecrets } from "../security/redact.js"

/**
 * Contrato de EVENTOS cross-harness (PRD18 Sprint 3, inspirado em agent-hooks/
 * eyelet). Cada harness DECLARA o que suporta por evento — `enforced` (bloqueia
 * de verdade), `advisory` (orienta/audita depois) ou `unsupported`. A declaração
 * é a base do conformance: nenhum harness instrucional pode declarar `enforced`.
 *
 * Ledger local `.gstack/events/events.jsonl`: sem secrets (redação), sem prompt
 * bruto (trunca + declara), append-only. Fonte para `audit events`.
 */

export const EVENTS = Object.freeze([
  "session.start", "session.stop", "message.output",
  "tool.before", "tool.after", "mcp.call", "file.write", "command.exec",
])

export const EVENT_LEVELS = Object.freeze(["enforced", "partial", "advisory", "unsupported"])

// Declaração HONESTA por harness (o que existe HOJE, não o que se promete).
// `partial` = mecanismo real existe mas depende de instalação/validação.
export const EVENT_DECLARATIONS = Object.freeze({
  claude: {
    target: "~/.claude/settings.json (hooks) + hooks/*.py",
    format: "settings.json hooks v1",
    residualRisk: "hooks precisam estar registrados (install); usuário pode removê-los. tool.after é PostToolUse REAL mas advisory: observa/roteia a checagem, não desfaz a ação já executada",
    events: {
      "session.start": "enforced", "session.stop": "enforced", "message.output": "advisory",
      // tool.after = advisory: PostToolUse roda DEPOIS da ação — não bloqueia o que já rodou.
      "tool.before": "enforced", "tool.after": "advisory", "mcp.call": "enforced",
      "file.write": "enforced", "command.exec": "enforced",
    },
  },
  cursor: {
    target: "~/.cursor/hooks.json",
    format: "cursor hooks (beforeShellExecution)",
    residualRisk: "só command.exec tem hook real; o resto é rules (.mdc) sem bloqueio",
    events: {
      "session.start": "advisory", "session.stop": "unsupported", "message.output": "advisory",
      "tool.before": "partial", "tool.after": "unsupported", "mcp.call": "advisory",
      "file.write": "advisory", "command.exec": "partial",
    },
  },
  opencode: {
    target: "plugins manifest-owned (tool.execute.before)",
    format: "opencode plugin JS",
    residualRisk: "kill switch GSTACK_OPENCODE_DISABLE=1; plugin pode ser removido; config .jsonc nunca é tocada",
    events: {
      "session.start": "advisory", "session.stop": "unsupported", "message.output": "advisory",
      "tool.before": "partial", "tool.after": "advisory", "mcp.call": "unsupported",
      "file.write": "partial", "command.exec": "partial",
    },
  },
  codex: {
    target: "~/.codex (TOML + AGENTS.md)",
    format: "instruções + hooks best-effort",
    residualRisk: "sem garantia de bloqueio pré-ação — o agente pode ignorar",
    events: {
      "session.start": "advisory", "session.stop": "unsupported", "message.output": "advisory",
      "tool.before": "advisory", "tool.after": "advisory", "mcp.call": "advisory",
      "file.write": "advisory", "command.exec": "advisory",
    },
  },
  devin: {
    target: ".devin/hooks.v1.json (project-scoped)",
    format: "devin hooks v1",
    residualRisk: "partial até o Devin carregar os hooks de fato (doctor faz downgrade); cloud handoff sempre opt-in",
    events: {
      "session.start": "advisory", "session.stop": "unsupported", "message.output": "advisory",
      "tool.before": "partial", "tool.after": "partial", "mcp.call": "advisory",
      "file.write": "partial", "command.exec": "partial",
    },
  },
  // Instrucionais: NUNCA enforced (o texto pode ser ignorado pelo agente).
  gemini: instructional("~/.gemini/GEMINI.md"),
  copilot: instructional(".github/copilot-instructions.md"),
  windsurf: instructional("~/.codeium/windsurf/memories/global_rules.md"),
  kiro: instructional("~/.kiro/steering/"),
  hermes: {
    target: "~/.hermes/skills + MCP",
    format: "skills + MCP bidirecional",
    residualRisk: "enforcement parcial via MCP; sem pre-tool hook nativo",
    events: {
      "session.start": "advisory", "session.stop": "unsupported", "message.output": "advisory",
      "tool.before": "advisory", "tool.after": "advisory", "mcp.call": "partial",
      "file.write": "advisory", "command.exec": "advisory",
    },
  },
})

function instructional(target) {
  const events = {}
  for (const e of EVENTS) events[e] = e === "session.start" ? "advisory" : (e === "message.output" ? "advisory" : "unsupported")
  return { target, format: "instrução (markdown)", residualRisk: "o agente pode ignorar o texto — não é enforcement", events }
}

export function getEventDeclaration(harness) {
  return EVENT_DECLARATIONS[harness] || null
}

// ── Event Ledger (.gstack/events/events.jsonl) ──────────────────────────────

export function eventsPath(cwd) { return join(cwd, ".gstack", "events", "events.jsonl") }

const MAX_FIELD_CHARS = 300
// Campos que NUNCA entram no ledger (mesmo que o produtor mande).
const FORBIDDEN_FIELDS = /(prompt|transcript|env|token|secret|password|apikey|api[-_]key|authorization|credential)/i

/** Sanitiza um valor: redige secrets e trunca (anti-prompt-bruto). */
function cleanValue(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v)
  const { redacted } = redactSecrets(s)
  return redacted.length > MAX_FIELD_CHARS ? redacted.slice(0, MAX_FIELD_CHARS) + "…[truncado]" : redacted
}

/**
 * Registra um evento no ledger. Valida o nome, remove campos proibidos, redige
 * e trunca valores. @returns o registro gravado (ou {error}).
 */
export function recordHarnessEvent(cwd, { event, harness = "unknown", ...fields } = {}) {
  if (!EVENTS.includes(event)) return { error: "unknown_event", event, valid: [...EVENTS] }
  const clean = { ts: new Date().toISOString(), event, harness }
  for (const [k, v] of Object.entries(fields)) {
    if (FORBIDDEN_FIELDS.test(k) || v == null) continue
    clean[k] = cleanValue(v)
  }
  const dir = join(cwd, ".gstack", "events")
  mkdirSync(dir, { recursive: true })
  appendFileSync(eventsPath(cwd), JSON.stringify(clean) + "\n")
  return clean
}

export function readHarnessEvents(cwd, { limit = 50 } = {}) {
  const p = eventsPath(cwd)
  if (!existsSync(p)) return []
  return readFileSync(p, "utf-8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
    .slice(-limit)
}
