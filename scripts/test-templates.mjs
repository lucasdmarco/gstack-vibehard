#!/usr/bin/env node
// Template smoke (PRD finalprd10 P0.8): prova que um projeto criado RODA. Verifica
// metadados de cada template (README, .env.example, scripts coerentes) e cria o
// fullstack-monorepo em modo LITE end-to-end (scaffold + .gstack/app.json).
// O install+build pesado é OPT-IN (GSTACK_TEMPLATE_INSTALL=1) p/ manter o smoke rápido.
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const templatesDir = join(repoRoot, "templates", "templates")
let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { console.error(`  ✗ ${m}`); failures++ }
const readJson = (p) => JSON.parse(readFileSync(p, "utf-8"))

console.log("== template smoke ==")

// 1) Metadados dos templates FÍSICOS
for (const name of readdirSync(templatesDir).filter((d) => existsSync(join(templatesDir, d, "package.json")))) {
  const dir = join(templatesDir, name)
  const pkg = readJson(join(dir, "package.json"))
  const scripts = pkg.scripts || {}
  const coerente = ["dev", "build", "test"].every((s) => s in scripts)
  coerente ? ok(`${name}: scripts coerentes (dev/build/test)`) : bad(`${name}: faltam scripts dev/build/test`)
  existsSync(join(dir, "README.md")) ? ok(`${name}: README.md`) : bad(`${name}: sem README.md`)
  existsSync(join(dir, ".env.example")) ? ok(`${name}: .env.example`) : bad(`${name}: sem .env.example (env requerido não documentado)`)
}

// 2) Cria fullstack-monorepo em LITE e2e (sem side-effects externos)
const work = mkdtempSync(join(tmpdir(), "gstack-tpl-"))
try {
  const cwd = join(work, "ws"); mkdirSync(cwd, { recursive: true })
  process.env.GSTACK_SKIP_PREFLIGHT = "1"; process.env.GSTACK_SKIP_SIDE_EFFECTS = "1"
  const { createProject } = await import(`${pathToFileURL(join(repoRoot, "src", "cli", "create.js"))}`)
  await createProject({ args: ["smoke-app"], cwd, projectRoot: repoRoot, now: () => "2026-01-01T00:00:00.000Z",
    logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {} }, execSync: () => Buffer.from("ok") })
  const appDir = join(cwd, "smoke-app")
  existsSync(join(appDir, "package.json")) ? ok("lite fullstack: scaffold criou package.json") : bad("scaffold sem package.json")
  const app = readJson(join(appDir, ".gstack", "app.json"))
  app.mode === "lite" ? ok("lite fullstack: .gstack/app.json mode=lite") : bad(`mode inesperado: ${app.mode}`)
  existsSync(join(appDir, ".env.example")) ? ok("lite fullstack: .env.example presente no projeto") : bad("projeto sem .env.example")

  if (process.env.GSTACK_TEMPLATE_INSTALL === "1") {
    const { execFileSync } = await import("node:child_process")
    const isWin = process.platform === "win32"
    const npm = (a) => isWin ? execFileSync("cmd.exe", ["/c", "npm", ...a], { cwd: appDir, stdio: "inherit", timeout: 600000 })
      : execFileSync("npm", a, { cwd: appDir, stdio: "inherit", timeout: 600000 })
    try { npm(["install", "--no-audit", "--no-fund"]); npm(["run", "build"]); ok("lite fullstack: install + build OK") }
    catch (e) { bad(`install/build falhou: ${(e.message || "").slice(0, 80)}`) }
  } else {
    ok("install+build pesado: pulado (GSTACK_TEMPLATE_INSTALL=1 para rodar)")
  }
} catch (e) {
  bad(`erro fatal: ${e.message}`)
} finally {
  delete process.env.GSTACK_SKIP_PREFLIGHT; delete process.env.GSTACK_SKIP_SIDE_EFFECTS
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* cleanup */ }
}

if (failures > 0) { console.error(`\ntemplate smoke: ${failures} falha(s)`); process.exit(1) }
console.log("\ntemplate smoke: OK")
