import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { isBinaryAvailable } from "./deps.js"
import { stripBom } from "../util/json.js"

/**
 * Resolver ÚNICO de package manager (PRD 12 PR2). Detecta o PM correto do projeto
 * por prioridade e reporta um ESTADO honesto + reparo seguro — sem apagar lockfile
 * ou node_modules automaticamente. PURO/testável (io injetável).
 *
 * Prioridade: 1) campo `packageManager` do package.json; 2) lockfile versionado;
 * 3) `.gstack/app.json`; 4) layout de node_modules; 5) fallback (npm).
 *
 * Estados: ok | missing_binary | lockfile_conflict | node_modules_mismatch.
 */
const LOCKFILES = Object.freeze({
  "pnpm-lock.yaml": "pnpm",
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "bun.lockb": "bun",
})

export function resolvePackageManager(projectDir, io = {}) {
  const exists = io.exists || ((p) => existsSync(p))
  const readJson = io.readJson || ((p) => { try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return null } })
  const hasBinary = io.hasBinary || ((b) => isBinaryAvailable(b))

  const pkg = readJson(join(projectDir, "package.json")) || {}
  const app = readJson(join(projectDir, ".gstack", "app.json")) || {}

  // 1) campo packageManager (ex.: "pnpm@10.33.0")
  let pm = null, source = null, version = null
  const pmField = String(pkg.packageManager || "").match(/^([a-z]+)(?:@(.+))?$/)
  if (pmField) { pm = pmField[1]; version = pmField[2] || null; source = "package.json#packageManager" }

  // 2) lockfiles versionados (conflito = vários)
  const locks = Object.keys(LOCKFILES).filter((f) => exists(join(projectDir, f)))
  if (locks.length > 1) {
    return {
      pm: pm || LOCKFILES[locks[0]], source: "lockfiles", state: "lockfile_conflict", locks,
      detail: `múltiplos lockfiles versionados: ${locks.join(", ")}`,
      repair: `mantenha só o lockfile do PM canônico (${pm || LOCKFILES[locks[0]]}); remova os outros — NUNCA apague sem confirmar.`,
    }
  }
  if (!pm && locks.length === 1) { pm = LOCKFILES[locks[0]]; source = `lockfile (${locks[0]})` }

  // 3) .gstack/app.json
  if (!pm && app.packageManager) { pm = app.packageManager; source = ".gstack/app.json" }

  // 5) fallback
  if (!pm) { pm = "npm"; source = "fallback (npm)" }

  // 4) layout de node_modules (mismatch)
  const hasNM = exists(join(projectDir, "node_modules"))
  const isPnpmNM = exists(join(projectDir, "node_modules", ".pnpm"))
  if (hasNM && pm === "pnpm" && !isPnpmNM) {
    return {
      pm, source, state: "node_modules_mismatch",
      detail: "node_modules sem layout pnpm (`.pnpm` ausente), mas o PM é pnpm",
      repair: "reinstale com pnpm: `pnpm install` — NÃO apague node_modules sem confirmar.",
    }
  }
  if (hasNM && pm !== "pnpm" && isPnpmNM) {
    return {
      pm, source, state: "node_modules_mismatch",
      detail: `node_modules é layout pnpm, mas o PM resolvido é ${pm}`,
      repair: `use pnpm (mais provável) OU reinstale com ${pm} — NÃO apague node_modules sem confirmar.`,
    }
  }

  // binário disponível?
  if (!hasBinary(pm)) {
    return {
      pm, source, state: "missing_binary", detail: `${pm} não está no PATH`,
      repair: pm === "pnpm"
        ? "instale com `npm install -g pnpm` (sem admin; `corepack enable` precisa de admin no Windows)"
        : `instale o ${pm} (gerenciador do projeto)`,
    }
  }

  return { pm, source, version, state: "ok", detail: `${pm}${version ? "@" + version : ""} via ${source}` }
}
