import { readFileSync } from "fs"
import { join } from "path"
import { execFileSync as defaultExec } from "child_process"

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
export function publishGuard(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const exec = opts.exec || defaultExec
  const git = (...args) => {
    try { return String(exec("git", args, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15000 }) || "").trim() }
    catch { return null }
  }
  const checks = []
  const add = (id, status, detail) => checks.push({ id, status, detail })

  const pkg = readJson(join(cwd, "package.json"))
  const version = pkg && pkg.version ? String(pkg.version) : null
  if (!version) {
    add("package-version", "failed", "package.json sem campo version")
    return finalize(checks, null)
  }
  add("package-version", "passed", version)

  // 1. working tree limpa
  const porcelain = git("status", "--porcelain")
  if (porcelain === null) add("tree-clean", "not_applicable", "não é repositório git")
  else if (porcelain === "") add("tree-clean", "passed", "working tree limpa")
  else add("tree-clean", "failed", `working tree suja (${porcelain.split("\n").filter(Boolean).length} arquivo(s) não commitado(s))`)

  // 2. versão bumpada vs última tag semver
  const tags = (git("tag", "--list") || "").split("\n").map((t) => t.trim()).filter(Boolean)
  const semverTags = tags.filter((t) => /^v?\d+\.\d+\.\d+/.test(t))
  if (semverTags.length === 0) {
    add("version-bump", "passed", "primeira release (sem tags anteriores)")
  } else {
    const latest = semverTags.reduce((a, b) => (semverGt(b, a) ? b : a))
    if (semverGt(version, latest)) add("version-bump", "passed", `${version} > ${latest}`)
    else add("version-bump", "failed", `versão ${version} não está acima da última tag ${latest}`)
  }

  // 3. CHANGELOG com entrada da versão
  const changelog = readFile(join(cwd, "CHANGELOG.md")) ?? readFile(join(cwd, "CHANGELOG"))
  if (changelog === null) add("changelog-entry", "failed", "CHANGELOG.md ausente")
  else if (changelog.includes(version)) add("changelog-entry", "passed", `entrada para ${version} encontrada`)
  else add("changelog-entry", "failed", `CHANGELOG.md sem entrada para ${version}`)

  // 4. tag da versão (soft — o fluxo cria a tag após publicar)
  const tagV = `v${version}`
  if (tags.includes(tagV) || tags.includes(version)) add("tag-exists", "warning", `tag ${tagV} já existe (re-publicação?)`)
  else add("tag-exists", "warning", `tag ${tagV} ainda não existe (crie após publicar)`)

  // 5. CI verde (opcional — só se `gh` disponível e não desabilitado)
  if (opts.checkCi === false || !ghAvailable(exec, cwd)) {
    add("ci-green", "not_applicable", "CI não verificado (gh ausente ou desabilitado)")
  } else {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "HEAD"
    let concl = null
    try {
      concl = String(exec("gh", ["run", "list", "--branch", branch, "--limit", "1", "--json", "conclusion", "-q", ".[0].conclusion"], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 20000 }) || "").trim()
    } catch { concl = null }
    if (concl === "success") add("ci-green", "passed", "última run do CI: success")
    else if (concl === null || concl === "") add("ci-green", "not_applicable", "CI sem run consultável")
    else add("ci-green", "warning", `última run do CI: ${concl}`)
  }

  return finalize(checks, version)
}

const HARD = new Set(["package-version", "tree-clean", "version-bump", "changelog-entry"])

function finalize(checks, version) {
  const failed = checks.filter((c) => c.status === "failed" && HARD.has(c.id)).map((c) => c.id)
  const warnings = checks.filter((c) => c.status === "warning").map((c) => c.id)
  return { status: failed.length ? "fail" : "pass", version, checks, failed, warnings }
}

function ghAvailable(exec, cwd) {
  try { exec("gh", ["--version"], { cwd, stdio: "pipe", timeout: 5000 }); return true } catch { return false }
}

function semverGt(a, b) {
  const pa = String(a).replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  }
  return false
}

function readFile(p) { try { return readFileSync(p, "utf-8") } catch { return null } }
function readJson(p) { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } }
