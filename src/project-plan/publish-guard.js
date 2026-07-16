import { readFileSync } from "fs"
import { join } from "path"
import { execFileSync as defaultExec } from "child_process"
import { checkSourceParity } from "../release/source-parity.js"
import { contractFor } from "../dream/claim-contract.js"
import { audit as defaultAudit } from "../dream/auditor.js"

/**
 * publish-guard — check determinístico de checkpoint para publicar um pacote.
 *
 * Automatiza o ritual manual de release (tree limpa? versão bumpada? CHANGELOG?
 * tag? CI verde?). Tudo local/git, sem LLM, sem rede obrigatória (CI é opcional
 * via `gh`). `exec` é injetável → testes não tocam git/rede real.
 *
 * Checks HARD (bloqueiam): package-version, tree-clean, version-bump, changelog-entry.
 * Soft: tag-exists (warning), ci-green (not_applicable sem `gh`).
 *
 * @returns {{ status:"pass"|"fail", version:string|null, checks:Array, failed:string[], warnings:string[] }}
 */
const gitOf = (exec, cwd) => (...args) => {
  try { return String(exec("git", args, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15000 }) || "").trim() }
  catch { return null }
}
const row = (id, status, detail) => ({ id, status, detail })

// 1. working tree limpa
function checkTreeClean(porcelain) {
  if (porcelain === null) return row("tree-clean", "not_applicable", "não é repositório git")
  if (porcelain === "") return row("tree-clean", "passed", "working tree limpa")
  return row("tree-clean", "failed", treeDirtyDetail(porcelain))
}
// 2. versão bumpada vs última tag semver
const bumpGuide = (version, latest) =>
  (latest.replace(/^v/, "") === version.replace(/^v/, "")
    ? `versão ${version} já tem tag ${latest} — se é NOVA release, bump para a próxima; se é só validação local, use o verify normal (publish é advisory em lib/CLI)`
    : `versão ${version} não está acima da última tag ${latest} — faça o bump antes de publicar`)
function checkVersionBump(version, tags) {
  const semverTags = tags.filter((t) => /^v?\d+\.\d+\.\d+/.test(t))
  if (semverTags.length === 0) return row("version-bump", "passed", "primeira release (sem tags anteriores)")
  const latest = semverTags.reduce((a, b) => (semverGt(b, a) ? b : a))
  if (semverGt(version, latest)) return row("version-bump", "passed", `${version} > ${latest}`)
  return row("version-bump", "failed", bumpGuide(version, latest))
}
// 3. CHANGELOG com entrada da versão
function checkChangelog(cwd, version) {
  const changelog = readFile(join(cwd, "CHANGELOG.md")) ?? readFile(join(cwd, "CHANGELOG"))
  if (changelog === null) return row("changelog-entry", "failed", "CHANGELOG.md ausente")
  if (changelog.includes(version)) return row("changelog-entry", "passed", `entrada para ${version} encontrada`)
  return row("changelog-entry", "failed", `CHANGELOG.md sem entrada para ${version}`)
}
// 3.5. QG_VERSION sincronizado com o package — impede release com qg.py stale.
function checkQgVersion(qgVersion, version) {
  if (qgVersion === null) return row("qg-version", "not_applicable", "hooks/hooks/qg.py não encontrado")
  if (qgVersion === version) return row("qg-version", "passed", `qg.py em ${qgVersion}`)
  return row("qg-version", "failed", `qg.py em ${qgVersion} ≠ package ${version} — rode \`node scripts/sync-qg-version.mjs\``)
}
// 4. tag da versão (soft — o fluxo cria a tag após publicar)
function checkTagExists(version, tags) {
  const tagV = `v${version}`
  const has = tags.includes(tagV) || tags.includes(version)
  return row("tag-exists", "warning", has ? `tag ${tagV} já existe (re-publicação?)` : `tag ${tagV} ainda não existe (crie após publicar)`)
}
// 5. CI verde (opcional — só se `gh` disponível e não desabilitado)
function ciConclusion(exec, cwd, branch) {
  try {
    return String(exec("gh", ["run", "list", "--branch", branch, "--limit", "1", "--json", "conclusion", "-q", ".[0].conclusion"], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 20000 }) || "").trim()
  } catch { return null }
}
function checkCiGreen(opts, exec, cwd, git) {
  if (opts.checkCi === false || !ghAvailable(exec, cwd)) return row("ci-green", "not_applicable", "CI não verificado (gh ausente ou desabilitado)")
  const concl = ciConclusion(exec, cwd, git("rev-parse", "--abbrev-ref", "HEAD") || "HEAD")
  if (concl === "success") return row("ci-green", "passed", "última run do CI: success")
  if (!concl) return row("ci-green", "not_applicable", "CI sem run consultável")
  return row("ci-green", "warning", `última run do CI: ${concl}`)
}

// Fontes injetáveis isoladas: mantêm os ternários fora do corpo dos checks.
const readVersion = (cwd) => {
  const pkg = readJson(join(cwd, "package.json"))
  if (!pkg || !pkg.version) return null
  return String(pkg.version)
}
const listTags = (git) => (git("tag", "--list") || "").split("\n").map((t) => t.trim()).filter(Boolean)
const dreamOf = (opts) => (opts.dream ? opts.dream() : safeAudit())
const capsOf = (opts, cwd) => (opts.capabilityReport ? opts.capabilityReport() : readCapabilityReport(cwd))
const qgOf = (opts, cwd) => (opts.readQgVersion ? opts.readQgVersion(cwd) : readQgVersion(cwd))

function buildChecks({ opts, cwd, exec, git, version, tags }) {
  return [
    row("package-version", "passed", version),
    checkTreeClean(git("status", "--porcelain")),
    checkVersionBump(version, tags),
    checkChangelog(cwd, version),
    checkQgVersion(qgOf(opts, cwd), version),
    // release-source-parity (HARD) — impede publicar commit/árvore não auditável a partir
    // da fonte pública (PRD41 S41.0 / P0.2). Sem remoto → not_applicable.
    checkSourceParity({ cwd, exec, version, checkPack: opts.checkPack === true, npmPack: opts.npmPack }),
    // PRD45 S45.0 — não publicar prometendo o que não foi provado.
    checkDreamRequired(dreamOf(opts)),
    checkCapabilityE2E(capsOf(opts, cwd)),
    checkTagExists(version, tags),
    checkCiGreen(opts, exec, cwd, git),
  ]
}

export function publishGuard(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const exec = opts.exec || defaultExec
  const git = gitOf(exec, cwd)
  const version = readVersion(cwd)
  if (!version) return finalize([row("package-version", "failed", "package.json sem campo version")], null)
  return finalize(buildChecks({ opts, cwd, exec, git, version, tags: listTags(git) }), version)
}

const HARD = new Set([
  "package-version", "tree-clean", "version-bump", "changelog-entry", "qg-version", "release-source-parity",
  // PRD45 S45.0: publicar prometendo prova inexistente é o pior defeito possível — HARD.
  "dream-required", "capability-e2e",
])

const safeAudit = () => { try { return defaultAudit({ behavioral: true }) } catch { return null } }

/**
 * PRD45 S45.0 — `dream NOT_PROVED` de claim REQUIRED bloqueia o publish.
 * "Required" = claim com CONTRATO comportamental declarado (CLAIM_CONTRACTS): ali o produto
 * afirma ter E2E + controle negativo. Se um desses não está REAL, estamos prometendo prova
 * que não existe. Claim SEM contrato pode ser NOT_PROVED honesto (hoje são 19) — travar em
 * todos tornaria o gate insatisfazível, e gate que nunca passa vira enfeite ignorado.
 * RISK/PLACEBO jamais publicam (mesma régua do proof).
 */
const tallyOf = (summary, key) => Number((summary || {})[key]) || 0
// RISK/PLACEBO jamais publicam (mesma régua do proof). @returns detalhe ou null.
function toxicDetail(summary) {
  const risk = tallyOf(summary, "RISK")
  const placebo = tallyOf(summary, "PLACEBO")
  if (risk + placebo === 0) return null
  return `${risk} RISK / ${placebo} PLACEBO — nunca publicar`
}
const requiredClaims = (claims) => claims.filter((c) => contractFor(c.id))
const unprovedDetail = (claims) => requiredClaims(claims)
  .filter((c) => c.status !== "REAL")
  .map((c) => `${c.id}:${c.status}`)

function checkDreamRequired(d) {
  const id = "dream-required"
  if (!d || !Array.isArray(d.claims)) return row(id, "not_applicable", "dream audit indisponível")
  const toxic = toxicDetail(d.summary)
  if (toxic) return row(id, "failed", toxic)
  const unproved = unprovedDetail(d.claims)
  if (unproved.length) return row(id, "failed", `contrato declarado sem prova: ${unproved.join(", ")}`)
  return row(id, "passed", `${requiredClaims(d.claims).length} claim(s) com contrato comportamental REAL`)
}

/**
 * PRD45 S45.0 — capacidade REQUIRED fora de `passed` bloqueia o publish.
 * Cobre `failed` (E2E reprovou), `not_proved` (engine de pé, E2E não rodou — o falso-verde
 * do `dockerAvailable() ? "passed"`) e `blocked_missing_engine` (sem engine: não se publica
 * às cegas). `not_applicable` (plataforma não suporta) é honesto e não é dívida de prova.
 */
const CAP_OK = new Set(["passed", "not_applicable"])
function checkCapabilityE2E(report) {
  const id = "capability-e2e"
  if (!report || !Array.isArray(report.capabilities)) {
    return row(id, "not_applicable", "sem relatório de capacidades — rode `npm run test:cleanmachine`")
  }
  const req = report.capabilities.filter((c) => c.required)
  const bad = req.filter((c) => !CAP_OK.has(c.status))
  if (bad.length) return row(id, "failed", bad.map((c) => `${c.id}:${c.status}`).join(", "))
  return row(id, "passed", `${req.length} capacidade(s) required em passed/not_applicable`)
}
function readCapabilityReport(cwd) {
  return readJson(join(cwd, ".gstack", "reports", "cleanmachine.json"))
}

/**
 * Detalhe ACIONÁVEL do tree-clean: lista OS ARQUIVOS (até 5) em vez de só contar
 * (PRD25 25.1 — reportar estado; NUNCA apagar arquivo do usuário). Gate segue HARD.
 */
function treeDirtyDetail(porcelain) {
  const lines = porcelain.split("\n").filter(Boolean)
  const shown = lines.slice(0, 5).map((l) => l.trim()).join(", ")
  const more = lines.length > 5 ? ` (+${lines.length - 5})` : ""
  return `working tree suja (${lines.length} arquivo(s) não commitado(s)): ${shown}${more} — commit, mova ou ignore; nada é apagado`
}

/** Lê QG_VERSION de hooks/hooks/qg.py (label do Quality Gate). null se ausente. */
function readQgVersion(cwd) {
  const src = readFile(join(cwd, "hooks", "hooks", "qg.py"))
  if (src === null) return null
  const m = src.match(/^QG_VERSION = "(.*)"$/m)
  return m ? m[1] : null
}

function finalize(checks, version) {
  const failed = checks.filter((c) => c.status === "failed" && HARD.has(c.id)).map((c) => c.id)
  const warnings = checks.filter((c) => c.status === "warning").map((c) => c.id)
  return { status: failed.length ? "fail" : "pass", version, checks, failed, warnings }
}

function ghAvailable(exec, cwd) {
  try { exec("gh", ["--version"], { cwd, stdio: "pipe", timeout: 5000 }); return true } catch { return false }
}

// [major, minor, patch] — pré-release ignorado (só ordena a linha estável).
const semverParts = (v) => {
  const core = String(v).replace(/^v/, "").split("-")[0].split(".")
  return [0, 1, 2].map((i) => Number.parseInt(core[i], 10) || 0)
}
function semverGt(a, b) {
  const pa = semverParts(a)
  const pb = semverParts(b)
  const i = [0, 1, 2].find((k) => pa[k] !== pb[k])
  if (i === undefined) return false
  return pa[i] > pb[i]
}

function readFile(p) { try { return readFileSync(p, "utf-8") } catch { return null } }
function readJson(p) { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } }
