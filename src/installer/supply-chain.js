import { execFileSync } from "child_process"
import { delimiter, join, resolve } from "path"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { ALLOWED_REMOTE_ORIGINS } from "./remote-policy.js"
import { verifyArtifactLock, GSTACK_ARTIFACT_LOCK } from "./artifact-lock.js"

/**
 * Supply Chain Doctor (PRD14 §4.7): checagens OFFLINE-FIRST e determinísticas
 * sobre a cadeia de suprimento da máquina — registry npm, binários críticos no
 * PATH (com detecção de local suspeito), allowlist de fontes remotas e fontes
 * oficiais do produto. Mirrors não oficiais são alertados, nunca silenciados.
 */

export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org"
export const OFFICIAL_SOURCES = Object.freeze({
  npm: "https://www.npmjs.com/package/@gstack-vibehard/installer",
  github: "https://github.com/lucasdmarco/gstack-vibehard",
})

// Binários que o produto invoca — presença/origem importam para a cadeia.
const CRITICAL_BINS = Object.freeze(["node", "npm", "git", "python"])
const OPTIONAL_BINS = Object.freeze(["bun", "uv", "fallow", "headroom", "ecc", "opencode"])

function tryExec(exec, file, args) {
  try {
    return String(exec(file, args, { stdio: "pipe", shell: false, timeout: 10000, encoding: "utf-8" }) || "").trim()
  } catch { return null }
}

const BIN_EXTS = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]

function pathDirs(env) {
  return String(env.PATH || env.Path || "").split(delimiter).filter(Boolean)
}

/** Resolve um binário no PATH (cross-platform, sem shell). */
export function resolveBin(name, env = process.env) {
  const candidates = pathDirs(env).flatMap((dir) => BIN_EXTS.map((ext) => join(dir, name + ext)))
  return candidates.find((p) => existsSync(p)) || null
}

const PATH_SEP = process.platform === "win32" ? "\\" : "/"

/** Local suspeito para binário crítico: temp ou o próprio cwd (PATH hijack). */
export function isSuspiciousLocation(binPath, { cwd = process.cwd() } = {}) {
  if (!binPath) return false
  const p = resolve(binPath).toLowerCase()
  const tmp = resolve(tmpdir()).toLowerCase()
  const here = resolve(cwd).toLowerCase()
  return p.startsWith(tmp + PATH_SEP) || p === tmp || p.startsWith(here + PATH_SEP)
}

function registryCheck(exec) {
  const reg = tryExec(exec, "npm", ["config", "get", "registry"])
  if (!reg) return { id: "npm-registry", status: "warning", detail: "npm indisponível — registry não verificado" }
  const official = reg.replace(/\/$/, "") === OFFICIAL_NPM_REGISTRY
  return official
    ? { id: "npm-registry", status: "ok", detail: `registry oficial (${OFFICIAL_NPM_REGISTRY})` }
    : { id: "npm-registry", status: "critical", detail: `registry NÃO oficial: ${reg} — mirrors não revisados são risco de malware` }
}

function binCheck(name, required, { exec, env, cwd }) {
  const path = resolveBin(name, env)
  if (!path) {
    return { id: `bin:${name}`, status: required ? "warning" : "ok", detail: required ? `${name} ausente do PATH` : `${name} ausente (opcional)` }
  }
  if (isSuspiciousLocation(path, { cwd })) {
    return { id: `bin:${name}`, status: "critical", detail: `${name} resolvido em local SUSPEITO (${path}) — possível PATH hijack` }
  }
  const version = tryExec(exec, name, ["--version"])
  return { id: `bin:${name}`, status: "ok", detail: `${path}${version ? ` (${version.split("\n")[0].slice(0, 40)})` : ""}` }
}

function allowlistCheck() {
  return {
    id: "remote-allowlist",
    status: "ok",
    detail: `downloads remotos são opt-in e restritos a: ${ALLOWED_REMOTE_ORIGINS.join(", ")}`,
  }
}

// PRD45 S45.6 (P1.9): substitui o `hashes: ok` mentiroso pela verificação REAL do artifact lock.
// `verified` = todos os artefatos fixados por digest/commit/integrity; `unknown` = há download
// opt-in sem sha publicado (honesto, não bloqueia); `blocked` = artefato mutável/malformado.
const LOCK_STATUS_MAP = Object.freeze({ verified: "ok", unknown: "warning", blocked: "critical" })
function artifactLockCheck() {
  const lock = verifyArtifactLock(GSTACK_ARTIFACT_LOCK)
  const blockedOrUnknown = lock.artifacts.filter((a) => a.status !== "verified")
  const suffix = blockedOrUnknown.length ? ` — pendências: ${blockedOrUnknown.map((a) => `${a.id}:${a.status}`).join(", ")}` : ""
  return { id: "artifact-lock", status: LOCK_STATUS_MAP[lock.status] || "warning", detail: `integridade da cadeia: ${lock.status} (${lock.artifacts.length} artefato(s))${suffix}` }
}

/** Nível de risco agregado a partir dos checks. */
export function riskLevel(checks) {
  if (checks.some((c) => c.status === "critical")) return "high"
  if (checks.some((c) => c.status === "warning")) return "low"
  return "none"
}

/**
 * Relatório completo. Offline-first: nenhuma chamada de rede — só configs e
 * PATH locais. `exec`/`env`/`cwd` injetáveis para teste hermético.
 */
export function buildSupplyChainReport(opts = {}) {
  const exec = opts.exec || execFileSync
  const env = opts.env || process.env
  const cwd = opts.cwd || process.cwd()
  const checks = [
    registryCheck(exec),
    ...CRITICAL_BINS.map((b) => binCheck(b, true, { exec, env, cwd })),
    ...OPTIONAL_BINS.map((b) => binCheck(b, false, { exec, env, cwd })),
    allowlistCheck(),
    artifactLockCheck(),
  ]
  return {
    schemaVersion: "gstack.supplychain.v1",
    officialSources: OFFICIAL_SOURCES,
    checks,
    risk: riskLevel(checks),
  }
}
