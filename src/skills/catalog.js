import { readFileSync, readdirSync, existsSync } from "fs"
import { createHash } from "crypto"
import { join, dirname, basename } from "path"
import { fileURLToPath } from "url"

// As skills são SHIPADAS COM O PRODUTO (files: skills/, agents/, agent-packs/).
// Default = raiz do pacote — a MESMA lição do dream audit (CM-08): medir o
// PRODUTO, não o cwd do usuário (cwd vazio dava catálogo 0 e rota vazia).
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
// Raiz do PACOTE (onde as skills são shipadas) — o comando `skills` deve catalogar
// isto, NÃO o cwd do usuário (lição CM-08; máquina limpa dava "0 skills").
export const SKILL_PACKAGE_ROOT = PACKAGE_ROOT

/**
 * Skill Catalog determinístico (PRD29 Sprint 29.0).
 *
 * As skills do produto são conhecimento versionado (SKILL.md), mas até aqui nada
 * as listava de forma DETERMINÍSTICA: contagem, hash, provenance e fase. Este
 * módulo varre as raízes versionadas, extrai frontmatter e classifica — a
 * contagem é MEDIDA, nunca assumida (o PRD cita 213; o catálogo reporta o real).
 *
 * Segurança: lê SOMENTE arquivos SKILL.md. Nunca abre `.env*`, nunca executa
 * nada do conteúdo. PURO/testável (io injetável).
 */

export const CATALOG_SCHEMA = "gstack.skill-catalog.v1"

// Raízes versionadas onde SKILL.md é fonte (o pack é derivado do caminho).
export const SKILL_SOURCE_ROOTS = Object.freeze(["skills", "agent-packs", "agents"])

// 10 fases do SDLC (PRD29 §3.2) com palavras-chave de classificação inicial.
// A PRIMEIRA fase que casar vira principal; demais casadas entram como secundárias.
const PHASE_KEYWORDS = Object.freeze([
  ["design-ui", /design system|frontend|\bui\b|component|tailwind|css|mockup|screenshot|canvas|visual/i],
  ["data-auth-api", /database|supabase|postgres|migration|\bauth\b|\bapi\b|webhook|openapi|stripe|payment/i],
  ["test-preview", /test|preview|playwright|browser|screenshot regression|\bqa\b/i],
  ["security", /security|secret|vulnerab|threat|penetration|injection|owasp/i],
  ["delegation-parallel", /delegat|parallel|worktree|orchestrat|subagent|dispatch/i],
  ["ship-closeout", /deploy|release|ship|\bpr\b|pull request|changelog|memory|chronicle|closeout/i],
  ["context-research", /research|context|graphify|search|scout|index|documentation lookup/i],
  ["planning-spec", /plan|spec|requirement|product|criteri|architecture decision/i],
  ["implementation", /refactor|clean code|implement|debug|lint|typescript|python|node/i],
  ["intake-onboarding", /onboard|intake|init|start|wizard|setup/i],
])

// Sinais de risco no CORPO da skill (texto, nunca executado): comandos
// destrutivos/rede/secrets elevam o risco declarado.
const RISK_SIGNALS = Object.freeze([
  { level: "high", match: /rm -rf|del \/[fsq]|format |taskkill|shutdown|curl[^\n]*\|\s*(ba)?sh|\.env\b/i },
  { level: "medium", match: /\bsudo\b|npm install -g|pip install|Invoke-WebRequest|fetch\(|http[s]?:\/\//i },
])

function defaultIo(root) {
  return {
    exists: (p) => existsSync(join(root, p)),
    read: (p) => readFileSync(join(root, p), "utf-8"),
    // walk recursivo por diretório retornando caminhos RELATIVOS posix de SKILL.md
    listSkillFiles: (rel) => walkSkillFiles(root, rel),
  }
}

const skipEntry = (name) => name === "node_modules" || name.startsWith(".")
function readDirents(dir) {
  try { return readdirSync(dir, { withFileTypes: true }) } catch { return [] }
}
function visitEntry(e, dir, childRel, out) {
  if (e.isDirectory()) walkDir(join(dir, e.name), childRel, out)
  else if (e.name === "SKILL.md") out.push(childRel.replaceAll("\\", "/"))
}
function walkDir(dir, rel, out) {
  for (const e of readDirents(dir)) {
    if (skipEntry(e.name)) continue
    visitEntry(e, dir, rel ? `${rel}/${e.name}` : e.name, out)
  }
}
function walkSkillFiles(root, rel) {
  const out = []
  const abs = join(root, rel)
  if (existsSync(abs)) walkDir(abs, rel.replaceAll("\\", "/"), out)
  return out
}

/** Frontmatter mínimo (--- key: value ---). null = ausente/ilegível. */
export function parseFrontmatter(content) {
  const m = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const fields = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (kv) fields[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim()
  }
  return fields
}

function classifyPhases(text) {
  const hits = PHASE_KEYWORDS.filter(([, re]) => re.test(text)).map(([phase]) => phase)
  return hits.length ? hits.slice(0, 3) : ["implementation"]
}

function classifyRisk(body) {
  const hit = RISK_SIGNALS.find((r) => r.match.test(body))
  return hit ? hit.level : "low"
}

// pack derivado do caminho: skills/skills/x → "skills"; agent-packs/<p>/… →
// "agent-packs/<p>"; agents/generated/<h>/… → "agents-generated/<h>"; agents/… → "agents".
function packOf(relPath) {
  const parts = relPath.split("/")
  if (parts[0] === "agent-packs") return `agent-packs/${parts[1]}`
  if (parts[0] === "agents" && parts[1] === "generated") return `agents-generated/${parts[2]}`
  return parts[0]
}

// Identidade (frontmatter) separada da análise de corpo — cc baixa por parte.
function skillIdentity(relPath, content) {
  const fm = parseFrontmatter(content)
  return {
    id: basename(dirname(relPath)),
    path: relPath,
    hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    name: (fm && fm.name) || null,
    description: (fm && fm.description) || null,
    pack: packOf(relPath),
    frontmatter: fm ? "ok" : "missing",
  }
}
function skillAnalysis(content, hasFrontmatter) {
  const body = hasFrontmatter ? content.slice(content.indexOf("---", 4) + 3) : content
  return {
    phases: classifyPhases(content),
    risk: classifyRisk(body),
    requiresUserInput: /pergunt|ask the user|confirm|\[y\/n\]/i.test(body),
    canRunCommands: /```(bash|sh|powershell|cmd)|npx |npm run/i.test(body),
  }
}
function skillEntry(relPath, content) {
  const identity = skillIdentity(relPath, content)
  return { ...identity, ...skillAnalysis(content, identity.frontmatter === "ok") }
}

/**
 * Varre as raízes e monta o catálogo. `totalSkills` é MEDIDO. Determinístico:
 * ordena por path; hash sha256 por arquivo = provenance/drift baseline (29.7).
 */
export function buildSkillCatalog({ root = PACKAGE_ROOT, io } = {}) {
  const ctx = io || defaultIo(root)
  const files = SKILL_SOURCE_ROOTS.flatMap((r) => ctx.listSkillFiles(r)).sort()
  const skills = files.map((relPath) => skillEntry(relPath, ctx.read(relPath)))
  const byPack = {}
  for (const s of skills) byPack[s.pack] = (byPack[s.pack] || 0) + 1
  return {
    schemaVersion: CATALOG_SCHEMA,
    generatedAt: new Date().toISOString(),
    sources: [...SKILL_SOURCE_ROOTS],
    totalSkills: skills.length,
    byPack,
    missingFrontmatter: skills.filter((s) => s.frontmatter === "missing").length,
    skills,
  }
}

// ── skills doctor (29.0: básico; drift/stale completo chega no 29.7) ─────────────
const DOCTOR_CHECKS = Object.freeze([
  { id: "frontmatter_missing", severity: "warning", find: (c) => c.skills.filter((s) => s.frontmatter === "missing").map((s) => s.path) },
  { id: "description_empty", severity: "warning", find: (c) => c.skills.filter((s) => s.frontmatter === "ok" && !s.description).map((s) => s.path) },
  { id: "duplicate_id_same_pack", severity: "problem", find: findDuplicateIds },
  { id: "high_risk_commands", severity: "info", find: (c) => c.skills.filter((s) => s.risk === "high").map((s) => s.path) },
])

function findDuplicateIds(catalog) {
  const seen = new Map()
  const dupes = []
  for (const s of catalog.skills) {
    const key = `${s.pack}::${s.id}`
    if (seen.has(key)) dupes.push(s.path)
    seen.set(key, true)
  }
  return dupes
}

/** Diagnóstico do catálogo: findings por check; ok=false só com `problem`. */
export function skillsDoctor(catalog) {
  const findings = DOCTOR_CHECKS
    .map((c) => ({ id: c.id, severity: c.severity, paths: c.find(catalog) }))
    .filter((f) => f.paths.length > 0)
  return {
    schemaVersion: "gstack.skills-doctor.v1",
    ok: !findings.some((f) => f.severity === "problem"),
    totalSkills: catalog.totalSkills,
    findings,
  }
}

/** Render markdown do catálogo (resumo por pack — o JSON é a fonte completa). */
export function renderCatalogMarkdown(catalog) {
  const lines = [
    `# Skill Catalog — ${catalog.totalSkills} skills`, "",
    `Gerado: ${catalog.generatedAt} · schema ${catalog.schemaVersion}`, "",
    "| Pack | Skills |", "|---|---:|",
    ...Object.entries(catalog.byPack).map(([p, n]) => `| ${p} | ${n} |`),
    "",
    `Frontmatter ausente: ${catalog.missingFrontmatter}`,
    "",
    "Fonte completa: `.gstack/skills/catalog.json` (hash/provenance por skill).", "",
  ]
  return lines.join("\n")
}
