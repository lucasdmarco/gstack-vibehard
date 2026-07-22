import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { tokensForDirection } from "../project-plan/design-direction.js"

/**
 * Design System Gate — universal, harness-agnostic (PRD29 29.3 + PRD28 28.11 + PRD34 F2-B).
 *
 * Até aqui o mandato de design system só existia no hook Python do Claude
 * (`hooks/hooks/pre_tool_use_security.py`) — ou seja, NÃO valia em Codex/OpenCode.
 * Este módulo eleva o gate para a camada CLI: `start` (e qualquer harness) bloqueia
 * escrita de UI sem design system declarado, com um artefato CANÔNICO
 * `.gstack/design-system.json`. Mantém compat: importa o `session_state.json`
 * legado e sincroniza de volta, para o hook Python continuar coerente.
 *
 * A skill aconselha; o gate DECIDE — verifier determinístico (status ∈ conjunto),
 * LLM nunca aprova. PURO/testável (io injetável, mesmo padrão de workspace.js).
 */

export const DESIGN_SYSTEM_SCHEMA = "gstack.design-system.v1"
export const DESIGN_SYSTEM_SCHEMA_V2 = "gstack.design-system.v2"
export const DESIGN_SYSTEM_GATE_SCHEMA = "gstack.design-system-gate.v1"

// Status que LIBERAM a escrita de UI. bypassed = opt-out explícito do usuário.
const PASS_STATUSES = Object.freeze(["complete", "generated", "bypassed"])

// ── Design Direction v2 (PRD42 S42.2) ────────────────────────────────────────────
// v1 aprovava por STATUS (qualquer engine/path virava "complete"). v2 valida CONTEÚDO
// quando o DS o DECLARA inline (direção + tokens). Declarações EXTERNAS (só path/engine)
// e artefatos v1 continuam grandfathered (não quebram projetos v1); a validação de
// conteúdo morde quem CLAMA ter gerado tokens mas os deixou vazios.
const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0
const nonEmptyColl = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v && typeof v === "object" && Object.keys(v).length > 0))

const CONTENT_CHECKS = Object.freeze([
  ["direction", (ds) => nonEmptyStr(ds.direction)],
  ["tokens.colors", (ds) => nonEmptyColl((ds.tokens || {}).colors)],
  ["tokens.typography", (ds) => nonEmptyColl((ds.tokens || {}).typography)],
])

/** Conteúdo mínimo do design system: direção declarada + tokens (colors E typography). */
export function validateDesignContent(ds) {
  if (!ds || typeof ds !== "object") return { ok: false, missing: CONTENT_CHECKS.map((c) => c[0]) }
  const missing = CONTENT_CHECKS.filter(([, ok]) => !ok(ds)).map(([k]) => k)
  return { ok: missing.length === 0, missing }
}

/** Um DS "declara conteúdo inline" (e portanto é validável) se traz tokens/direção ou status=generated. */
const declaresInlineContent = (ds) => Boolean(ds && (ds.tokens || ds.direction || ds.status === "generated"))

/** Migração NÃO-destrutiva v1→v2: preserva status/engine/path; marca origem e que conteúdo não foi validado. */
export function migrateDesignSystem(ds) {
  if (!ds) return ds
  if (ds.schemaVersion === DESIGN_SYSTEM_SCHEMA_V2) return ds
  return { ...ds, schemaVersion: DESIGN_SYSTEM_SCHEMA_V2, migratedFrom: ds.schemaVersion || "unknown", contentValidated: false }
}

// Extensões e diretórios que contam como UI (alinhado ao hook Python).
const UI_EXTS = Object.freeze([".tsx", ".jsx", ".css", ".scss", ".sass", ".less", ".html", ".vue", ".svelte"])
const UI_DIR_PATTERNS = Object.freeze([
  /(^|[\\/])components[\\/]/i,
  /(^|[\\/])pages[\\/]/i,
  /(^|[\\/])app[\\/]/i,
  /(^|[\\/])src[\\/]App\.[jt]sx?$/i,
])

/** true = escrever este caminho é "escrita de UI" (sujeita ao gate). */
export function isUiWrite(relPath) {
  const p = String(relPath || "")
  if (UI_EXTS.some((e) => p.toLowerCase().endsWith(e))) return true
  return UI_DIR_PATTERNS.some((re) => re.test(p))
}

const defaultIo = Object.freeze({
  exists: existsSync,
  readJson: (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } },
  writeJson: (p, obj) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2) + "\n") },
})

// Status derivado de um design-system.json (status explícito tem precedência).
function statusOfDs(ds) {
  if (ds && PASS_STATUSES.includes(ds.status)) return ds.status
  if (ds && (ds.engine || ds.path)) return "complete"
  return "missing"
}

// Importa o session_state.json legado → design-system.json canônico (uma vez).
// asked_about_design_system:true = pergunta resolvida (o hook Python já libera) → complete.
function importFromSessionState(gdir, dsPath, io) {
  const sPath = join(gdir, "session_state.json")
  if (!io.exists(sPath)) return null
  const s = io.readJson(sPath)
  if (!s || !s.asked_about_design_system) return null
  const ds = {
    schemaVersion: DESIGN_SYSTEM_SCHEMA, status: "complete",
    engine: s.design_system_engine ?? null, path: s.design_system_path ?? null,
    generatedAt: new Date().toISOString(), importedFrom: "session_state.json",
  }
  io.writeJson(dsPath, ds)
  return { status: "complete", source: "session_state.json", engine: ds.engine, path: ds.path, artifact: dsPath, imported: true }
}

const bypassedDs = (dsPath) => ({ status: "bypassed", source: "--design-system none", engine: null, path: null, artifact: dsPath, imported: false })
const missingDs = (dsPath) => ({ status: "missing", source: "none", engine: null, path: null, artifact: dsPath, imported: false })
// v2: migra o artefato lido, valida conteúdo SÓ se ele o declara inline, e carrega os campos
// de conteúdo p/ o gate decidir (declaresContent/contentValid/contentMissing).
function fromDsFile(raw, dsPath) {
  const ds = migrateDesignSystem(raw) || {}
  const declaresContent = declaresInlineContent(ds)
  const content = declaresContent ? validateDesignContent(ds) : { ok: true, missing: [] }
  return {
    status: statusOfDs(ds), source: "design-system.json",
    engine: ds.engine || null, path: ds.path || null, artifact: dsPath, imported: false,
    schemaVersion: ds.schemaVersion || null, declaresContent, contentValid: content.ok, contentMissing: content.missing,
  }
}

/**
 * Status canônico do design system do projeto. Ordem: bypass explícito >
 * design-system.json > import do session_state legado > missing.
 */
export function resolveDesignSystem({ root, bypass = null, io = defaultIo, importLegacy = true } = {}) {
  const gdir = join(root, ".gstack")
  const dsPath = join(gdir, "design-system.json")
  if (bypass === "none") return bypassedDs(dsPath)
  if (io.exists(dsPath)) return fromDsFile(io.readJson(dsPath), dsPath)
  return (importLegacy && importFromSessionState(gdir, dsPath, io)) || missingDs(dsPath)
}

/**
 * Registra o design system escolhido pelo usuário (--design-system <path|none>).
 * Grava o artefato canônico E sincroniza o session_state legado, para o hook
 * Python do Claude continuar coerente com a decisão feita na CLI.
 */

/**
 * PRD47 S47.2 — ponte PURA entre a `designDirection` do Product Brief (intake) e um
 * design-system v2 válido. NÃO persiste nada (o caller decide quando registrar via
 * `registerDesignSystem`/`io.writeJson`) — só traduz vocabulário sem duplicar a
 * lógica de gate. `none`/`custom` sem tokens do catálogo → null (nada a registrar
 * ainda; opt-out explícito continua sendo decisão do usuário, não um DS fabricado).
 */
export function designSystemFromDirection(designDirection) {
  if (!designDirection || designDirection.value === "none" || designDirection.value === "custom") return null
  const tokens = tokensForDirection(designDirection.value)
  if (!tokens) return null
  return {
    schemaVersion: DESIGN_SYSTEM_SCHEMA_V2, status: "generated",
    direction: designDirection.value, tokens,
    generatedAt: new Date().toISOString(), source: "product-brief-direction",
  }
}

export function registerDesignSystem({ root, choice, io = defaultIo } = {}) {
  const gdir = join(root, ".gstack")
  const dsPath = join(gdir, "design-system.json")
  const bypass = choice === "none"
  // v2: declaração EXTERNA (o usuário aponta um DS que já existe no `choice`). Sem tokens inline
  // → não passa por validação de conteúdo (grandfathered), mas fica marcado contentValidated:false.
  const ds = {
    schemaVersion: DESIGN_SYSTEM_SCHEMA_V2, status: bypass ? "bypassed" : "complete",
    engine: bypass ? null : "custom", path: bypass ? null : choice, contentValidated: false,
    generatedAt: new Date().toISOString(), source: "--design-system",
  }
  io.writeJson(dsPath, ds)
  io.writeJson(join(gdir, "session_state.json"), {
    asked_about_design_system: true, design_system_path: bypass ? null : choice,
    design_system_engine: ds.engine, syncedFrom: "design-system.json",
  })
  return { status: ds.status, source: "--design-system", engine: ds.engine, path: ds.path, artifact: dsPath, imported: false }
}

/**
 * Avalia o gate pre-write. Bloqueia quando há intenção de UI (uiIntended, ou
 * arquivos concretos de UI em `files`) e o design system NÃO está resolvido.
 * verifier determinístico: status ∈ {complete,generated,bypassed} libera.
 */
// v2: a razão do bloqueio distingue STATUS ausente de CONTEÚDO declarado-porém-incompleto.
function gateViolationReason(ds, contentPass) {
  if (!contentPass) return `design system declara conteúdo mas falta: ${(ds.contentMissing || []).join(", ") || "tokens/direção"}`
  return `escrita de UI sem design system (status=${ds.status})`
}
const requiredActionFor = (contentPass) => (contentPass
  ? "Declare o design system: responda no `start` ou use --design-system <caminho> (ou --design-system none para opt-out explícito)."
  : "Design system declara conteúdo incompleto: forneça direção + tokens (colors/typography) ou registre um caminho externo válido.")

const violationList = (uiFiles, reason) => (uiFiles.length ? uiFiles : ["<ui>"]).map((f) => ({ file: f, reason }))

// Decisão do gate (extraída p/ cc≤6): STATUS ausente OU conteúdo declarado-porém-inválido bloqueia.
function gateDecision(ds, uiFiles, touchesUi) {
  const statusPass = PASS_STATUSES.includes(ds.status)
  const contentPass = !ds.declaresContent || ds.contentValid !== false // v2: conteúdo declarado deve ser válido
  const blocked = touchesUi && !(statusPass && contentPass)
  return {
    blocked,
    violations: blocked ? violationList(uiFiles, gateViolationReason(ds, contentPass)) : [],
    requiredAction: blocked ? requiredActionFor(contentPass) : null,
  }
}

export function evaluatePreWriteGate({ root, runId = null, files = [], uiIntended = false, bypass = null, io = defaultIo } = {}) {
  const ds = resolveDesignSystem({ root, bypass, io })
  const uiFiles = files.filter(isUiWrite)
  const touchesUi = uiIntended || uiFiles.length > 0
  const d = gateDecision(ds, uiFiles, touchesUi)
  return {
    schemaVersion: DESIGN_SYSTEM_GATE_SCHEMA, gate: "design-system-gate",
    generatedAt: new Date().toISOString(), runId,
    designSystem: ds, uiFiles, touchesUi, blocked: d.blocked,
    violations: d.violations, requiredAction: d.requiredAction,
  }
}

/** Persiste as evidências do gate no run (contrato requiredEvidence da matriz). */
export function persistGateEvidence({ root, runId, evidence, io = defaultIo } = {}) {
  const runDir = join(root, ".gstack", "runs", runId || "adhoc")
  io.writeJson(join(runDir, "design-system-gate.json"), evidence)
  if (evidence.blocked) {
    io.writeJson(join(runDir, "skill-gate-violations.json"), {
      schemaVersion: DESIGN_SYSTEM_GATE_SCHEMA, runId: runId || null,
      gate: "design-system-gate", violations: evidence.violations,
    })
  }
  return runDir
}
