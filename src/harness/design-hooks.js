import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { dirname, join } from "path"
import { versionedBackup } from "../installer/safe-write.js"

/**
 * Project-local design hook projections (PRD49 S49.3).
 *
 * Escopo recalibrado após revisão de design (não é a matriz completa que o
 * plano original descrevia): cada harness recebe exatamente o mecanismo que
 * REALMENTE tem hoje, per `src/harness/events.js`/`src/agents/adapter-matrix.js`:
 *   - Claude: hook real (PostToolUse, advisory — tool.after já é "advisory" hoje)
 *   - Codex + OpenCode: nenhum tem API de hook project-local; ambos leem
 *     AGENTS.md, então recebem o MESMO bloco instrucional compartilhado
 *   - Copilot: sem hooks (instructional-only); bloco em .github/copilot-instructions.md
 *   - Cursor: regra .mdc project-local (rules_only — mesmo formato já usado
 *     em agents/generated/cursor/rules/*.mdc)
 *
 * NUNCA global: todo caminho é relativo a `projectRoot`, nunca a homedir(). Por
 * isso NÃO reusa safeWriteFile/writeWithBackup (acoplados ao manifest GLOBAL de
 * uninstall) — só `versionedBackup` (backup puro, sem registro de manifest).
 * Malformado aborta sem mutação; nada aqui bloqueia (todos advisory/instructional).
 */
export const DESIGN_HOOK_SCHEMA = "gstack.design-hook-projection.v1"

const MARKER_BEGIN = "<!-- gstack_vibehard:design-hooks:begin -->"
const MARKER_END = "<!-- gstack_vibehard:design-hooks:end -->"
const DETECT_CMD = "gstack_vibehard visual detect .gstack/design-elements.json --json || true"

// ── content builders (puros) ─────────────────────────────────────────────
export function buildInstructionalDesignHookBlock() {
  return [
    MARKER_BEGIN,
    "## Design detector (gstack_vibehard, advisory — nunca bloqueia)",
    "",
    "Antes de finalizar uma mudança de UI, rode (best-effort):",
    `  ${DETECT_CMD.replace(" || true", "")}`,
    "",
    "Hoje só verifica contraste WCAG entre texto e fundo (1 regra vendorizada do",
    "motor Impeccable, PRD49 S49.2A/B). Sem `.gstack/design-elements.json`, não há",
    "nada a checar — isso é esperado, não um erro.",
    MARKER_END,
  ].join("\n")
}

export function buildCursorDesignRule() {
  return [
    "---",
    'description: "gstack_vibehard design detector (advisory) — WCAG color-contrast."',
    "alwaysApply: false",
    "---",
    "",
    "# gstack_vibehard design detector",
    "",
    "> Gerado automaticamente por `gstack_vibehard visual hooks install`. Não edite manualmente.",
    "",
    "Antes de finalizar mudanças de UI, rode `visual detect .gstack/design-elements.json`",
    "(advisory — hoje só contraste WCAG, 1 regra vendorizada do motor Impeccable).",
    "",
  ].join("\n")
}

export function buildClaudeHookEntry() {
  return { matcher: "Write|Edit", hooks: [{ type: "command", command: DETECT_CMD }] }
}

const isGstackClaudeHookEntry = (e) => JSON.stringify(e).includes("visual detect")

// ── merge puro de bloco marcado ───────────────────────────────────────────
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

export function mergeMarkerBlock(existing, block) {
  if (existing.includes(MARKER_BEGIN)) {
    const re = new RegExp(`${escapeRe(MARKER_BEGIN)}[\\s\\S]*?${escapeRe(MARKER_END)}`)
    return existing.replace(re, block)
  }
  return (existing.trim() ? existing.trimEnd() + "\n\n" : "") + block + "\n"
}

// ── escrita project-local (backup local puro, SEM manifest global) ───────
function writeProjectFile(filePath, content) {
  if (existsSync(filePath)) versionedBackup(filePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function mergedClaudeSettings(existing) {
  const merged = { ...existing, hooks: { ...(existing.hooks || {}) } }
  const prior = Array.isArray(merged.hooks.PostToolUse) ? merged.hooks.PostToolUse : []
  const cleaned = prior.filter((e) => !isGstackClaudeHookEntry(e))
  merged.hooks.PostToolUse = [...cleaned, buildClaudeHookEntry()]
  return merged
}

/** Claude: PostToolUse hook em `.claude/settings.json` do PROJETO. Malformado aborta sem mutar. */
export function projectClaudeHook(projectRoot, readFileImpl = readFileSync) {
  const filePath = join(projectRoot, ".claude", "settings.json")
  const existed = existsSync(filePath)
  let existing = {}
  if (existed) {
    try { existing = JSON.parse(readFileImpl(filePath, "utf-8")) }
    catch { return { ok: false, harness: "claude", path: filePath, reason: "malformed_json_abort_no_mutation" } }
  }
  writeProjectFile(filePath, JSON.stringify(mergedClaudeSettings(existing), null, 2) + "\n")
  return { ok: true, harness: "claude", path: filePath, action: existed ? "merged" : "created" }
}

/** Codex + OpenCode: ambos leem AGENTS.md do projeto — nenhum tem hook project-local real. */
export function projectAgentsMdBlock(projectRoot, readFileImpl = readFileSync) {
  const filePath = join(projectRoot, "AGENTS.md")
  const existed = existsSync(filePath)
  const existing = existed ? readFileImpl(filePath, "utf-8") : ""
  writeProjectFile(filePath, mergeMarkerBlock(existing, buildInstructionalDesignHookBlock()))
  return { ok: true, harness: "codex+opencode", path: filePath, action: existed ? "merged" : "created" }
}

/** Copilot: sem hooks — instructional-only em .github/copilot-instructions.md. */
export function projectCopilotInstructions(projectRoot, readFileImpl = readFileSync) {
  const filePath = join(projectRoot, ".github", "copilot-instructions.md")
  const existed = existsSync(filePath)
  const existing = existed ? readFileImpl(filePath, "utf-8") : ""
  writeProjectFile(filePath, mergeMarkerBlock(existing, buildInstructionalDesignHookBlock()))
  return { ok: true, harness: "copilot", path: filePath, action: existed ? "merged" : "created" }
}

/** Cursor: regra .mdc project-local, gstack-owned (whole file, não compartilhado com o usuário). */
export function projectCursorRule(projectRoot) {
  const filePath = join(projectRoot, ".cursor", "rules", "gstack-design-detector.mdc")
  const existed = existsSync(filePath)
  writeProjectFile(filePath, buildCursorDesignRule())
  return { ok: true, harness: "cursor", path: filePath, action: existed ? "merged" : "created" }
}

/** Aplica as 4 projeções project-local. Nenhuma delas bloqueia (advisory/instructional). */
export function applyDesignHookProjections(projectRoot, opts = {}) {
  const readFileImpl = opts.readFile || readFileSync
  const results = [
    projectClaudeHook(projectRoot, readFileImpl),
    projectAgentsMdBlock(projectRoot, readFileImpl),
    projectCopilotInstructions(projectRoot, readFileImpl),
    projectCursorRule(projectRoot),
  ]
  return {
    schemaVersion: DESIGN_HOOK_SCHEMA,
    generatedAt: new Date().toISOString(),
    results,
    ok: results.every((r) => r.ok),
  }
}

const STATUS_CHECKS = Object.freeze([
  { harness: "claude", rel: [".claude", "settings.json"], test: (c) => { try { return JSON.stringify(JSON.parse(c)).includes("visual detect") } catch { return false } } },
  { harness: "codex+opencode", rel: ["AGENTS.md"], test: (c) => c.includes(MARKER_BEGIN) },
  { harness: "copilot", rel: [".github", "copilot-instructions.md"], test: (c) => c.includes(MARKER_BEGIN) },
  { harness: "cursor", rel: [".cursor", "rules", "gstack-design-detector.mdc"], test: () => true },
])

/** Read-only: NUNCA escreve no filesystem. Reporta o que já está instalado. */
export function designHookStatus(projectRoot) {
  return STATUS_CHECKS.map(({ harness, rel, test }) => {
    const filePath = join(projectRoot, ...rel)
    if (!existsSync(filePath)) return { harness, path: filePath, installed: false }
    try { return { harness, path: filePath, installed: test(readFileSync(filePath, "utf-8")) } }
    catch { return { harness, path: filePath, installed: false } }
  })
}
