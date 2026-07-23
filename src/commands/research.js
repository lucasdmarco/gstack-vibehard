import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs"
import { join, dirname, relative, isAbsolute } from "path"
import { spawnSync } from "child_process"
import { auditExternalSkills, renderAuditMarkdown } from "../skills/external-audit.js"
import { notebookLmDoctor, notebookLmConnect, notebookLmQuery, notebookLmImport } from "../tools/notebooklm.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `research skills audit --path <dir> | --repo <url>` (PRD29 29.5 / PRD34 F6-A).
 *
 * KNOWLEDGE layer: nunca edita fonte. Audita um MIRROR read-only de skills
 * externas e grava `.gstack/research/external-audit.{json,md}`. NUNCA executa
 * script do repo externo, NUNCA instala, NUNCA lê `.env`. `--repo` é opt-in
 * (rede) e faz clone raso desabilitando hooks; `--path` audita um mirror local.
 */

// Candidatos: SKILL.md/AGENTS.md/*.skill.md em qualquer lugar, ou arquivos de
// texto sob hooks/commands/agents/skills. Nunca abre `.env*`, `.git`, node_modules.
const CAND_NAME = /^SKILL\.md$|^AGENTS?\.md$|\.skill\.md$/i
const CAND_DIR = /(^|\/)(hooks|commands|agents|skills)\//i
const CAND_EXT = /\.(md|py|sh|ps1|js|ts|ya?ml|json)$/i
const skipEntry = (name) => name === ".git" || name === "node_modules" || name.startsWith(".env")

function isCandidate(rel) {
  const posix = rel.replaceAll("\\", "/")
  const base = posix.split("/").pop()
  if (CAND_NAME.test(base)) return true
  return CAND_DIR.test("/" + posix) && CAND_EXT.test(base)
}

function walkCandidates(root, dir, out, limit) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= limit) return
    if (skipEntry(e.name)) continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) walkCandidates(root, abs, out, limit)
    else if (isCandidate(relative(root, abs))) out.push(relative(root, abs).replaceAll("\\", "/"))
  }
}

const safeRead = (p) => { try { return readFileSync(p, "utf-8") } catch { return "" } }

export function collectMirrorFiles(dir) {
  const rels = []
  walkCandidates(dir, dir, rels, 2000)
  return rels.sort().map((rel) => ({ path: rel, content: safeRead(join(dir, rel)) }))
}

function readManifest(dir) {
  try { return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) } catch { return null }
}

const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

const manifestProvenance = (man, fallbackSource) => ({
  source: (man && man.url) || fallbackSource,
  commit: (man && man.commit) || null,
})

function resolveLocalMirror(path, cwd) {
  if (!path) return null
  const dir = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(dir)) { error(`research: --path não existe: ${dir}`); return null }
  return { dir, ...manifestProvenance(readManifest(dir), path) }
}

// Clone RASO read-only (opt-in, rede). Desabilita hooks; nunca roda script do repo.
function cloneReadOnly(url, dir) {
  mkdirSync(dirname(dir), { recursive: true })
  const r = spawnSync("git", ["-c", "core.hooksPath=", "clone", "--depth", "1", url, dir], { encoding: "utf-8" })
  if (r.status === 0) return true
  error(`research: clone falhou (${(r.stderr || "").trim() || r.error})`)
  return false
}

function headCommit(dir) {
  const head = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf-8" })
  return (head.stdout || "").trim() || null
}

function mirrorRepo(url, cwd) {
  const name = url.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")
  const dir = join(cwd, ".gstack", "research", "mirrors", name)
  if (!existsSync(dir) && !cloneReadOnly(url, dir)) return null
  return { dir, source: url, commit: headCommit(dir) }
}

function writeAuditArtifacts(cwd, audit) {
  const dir = join(cwd, ".gstack", "research")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "external-audit.json"), JSON.stringify(audit, null, 2) + "\n")
  writeFileSync(join(dir, "external-audit.md"), renderAuditMarkdown(audit))
  return dir
}

function renderAuditHuman(audit, dir) {
  const c = audit.counts
  section(`skills externas — ${audit.provenance.auditedFiles} arquivos (read-only)`)
  info(`  fonte: ${audit.provenance.source || "(local)"} · commit ${audit.provenance.commit || "?"}`)
  success(`  adopt ${c.adopt}`)
  info(`  adapt ${c.adapt} (rever/mapear antes de usar)`)
  if (c.avoid > 0) warn(`  avoid ${c.avoid} (destrutivo/exec-remoto/secret/install — nunca adotar sem revisão)`)
  info(`  nada executado/instalado · JSON: ${dir}\\external-audit.json`)
}

function auditCmd(cwd, args, json) {
  const repo = flagValue(args, "--repo")
  const mirror = repo ? mirrorRepo(repo, cwd) : resolveLocalMirror(flagValue(args, "--path"), cwd)
  if (!mirror) { if (!repo) error("research skills audit: informe --path <dir> ou --repo <url>"); process.exitCode = 1; return null }
  const audit = auditExternalSkills({ source: mirror.source, commit: mirror.commit, files: collectMirrorFiles(mirror.dir) })
  const dir = writeAuditArtifacts(cwd, audit)
  if (json) { process.stdout.write(JSON.stringify(audit) + "\n"); return audit }
  renderAuditHuman(audit, dir)
  return audit
}

function emitNotebookLm(payload, json, humanFn) {
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  humanFn(payload)
  return payload
}

function notebookLmDoctorCmd(json) {
  const r = notebookLmDoctor()
  return emitNotebookLm(r, json, (p) => {
    section("research notebooklm doctor")
    warn(`  status: ${p.status} — conector experimental, cloud, não-oficial`)
  })
}

function notebookLmConnectCmd(json) {
  const r = notebookLmConnect()
  return emitNotebookLm(r, json, (p) => { section("research notebooklm connect"); warn(`  ${p.message}`) })
}

function notebookLmQueryCmd(args, json) {
  const notebookId = flagValue(args, "--notebook")
  const question = flagValue(args, "--question")
  if (!notebookId || !question) { error("research notebooklm query: informe --notebook <id> --question <texto>"); process.exitCode = 1; return null }
  const r = notebookLmQuery({ notebookId, question })
  return emitNotebookLm(r, json, (p) => { section("research notebooklm query"); warn(`  status: ${p.status} (${p.category})`) })
}

function readImportResult(resultPath) {
  try { return JSON.parse(readFileSync(resultPath, "utf-8")) } catch { return null }
}

function notebookLmImportCmd(args, json) {
  const resultPath = flagValue(args, "--result")
  const to = flagValue(args, "--to")
  const approved = args.includes("--approved") // explícito na linha de comando -- --yes NUNCA basta (ver costGateStatus/spendConfirmed em outras sprints)
  if (!resultPath || !to) { error("research notebooklm import: informe --result <artefato> --to context|obsidian"); process.exitCode = 1; return null }
  const result = readImportResult(resultPath)
  if (!result) { error(`research notebooklm import: não consegui ler/parsear ${resultPath}`); process.exitCode = 1; return null }
  const r = notebookLmImport({ result, approved, to })
  if (!r.ok) process.exitCode = 1
  return emitNotebookLm(r, json, (p) => {
    section("research notebooklm import")
    ;(p.ok ? success : error)(p.ok ? `  importado para ${p.to} com ${p.sourceCitations.length} citação(ões)` : `  recusado: ${p.reason}`)
  })
}

const NOTEBOOKLM_HANDLERS = Object.freeze({
  doctor: (args, json) => notebookLmDoctorCmd(json),
  connect: (args, json) => notebookLmConnectCmd(json),
  query: (args, json) => notebookLmQueryCmd(args, json),
  import: (args, json) => notebookLmImportCmd(args, json),
})

function notebookLmCmd(sub, args, json) {
  const handler = NOTEBOOKLM_HANDLERS[sub[1]]
  if (handler) return handler(args, json)
  error("research notebooklm: use doctor|connect|query|import")
  process.exitCode = 1
  return null
}

function printResearchUsage() {
  section("research")
  info("  research skills audit --path <dir> [--json]   audita mirror local read-only (adopt/adapt/avoid)")
  info("  research skills audit --repo <url> [--json]    clona raso (opt-in, rede) e audita — nunca executa/instala")
  info("  research notebooklm doctor|connect|query|import   conector experimental (cloud, não-oficial)")
}

/** Dispatcher do `research`. */
export async function researchCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.filter((a) => !a.startsWith("-"))
  if (sub[0] === "skills" && sub[1] === "audit") return auditCmd(cwd, args, json)
  if (sub[0] === "notebooklm") return notebookLmCmd(sub, args, json)
  printResearchUsage()
}
