import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execFileSync } from "child_process"

/**
 * Delivery gates honestos (PRD faseprebuilt_2 R9). Orquestra SÓ os gates que
 * existem no projeto; o que não existe vira `not_applicable` (nunca finge passar).
 * runtime/preview são `pending_feature` (não implementados). Determinístico, com
 * exec injetável para testes herméticos.
 *
 * Status por gate: passed | failed | not_applicable | pending_feature
 * `ready` = nenhum gate falhou (NA/pending não bloqueiam).
 */

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return {} } }

/** Runner win32-aware: `npm ...` via cmd.exe no Windows (array, sem shell genérico). */
function defaultExec(file, args, opts) {
  if (process.platform === "win32" && file === "npm") {
    return execFileSync("cmd.exe", ["/c", "npm", ...args], { stdio: "pipe", timeout: 600000, ...opts })
  }
  return execFileSync(file, args, { stdio: "pipe", timeout: 600000, ...opts })
}

function findQgHook(home) {
  for (const p of [join(home, ".gstack", "hooks", "qg.py"), join(home, ".codex", "hooks", "qg.py")]) {
    if (existsSync(p)) return p
  }
  return null
}

export function runVerify(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const home = opts.home || homedir()
  const profile = opts.profile === "scaffold" ? "scaffold" : "full"
  const exec = opts.exec || defaultExec
  const pyBin = process.platform === "win32" ? "python" : "python3"

  const pkgPath = join(cwd, "package.json")
  const hasPkg = existsSync(pkgPath)
  const scripts = (hasPkg ? readJson(pkgPath).scripts : {}) || {}
  const hasPyTests = ["pytest.ini", "pyproject.toml", "requirements.txt"].some((f) => existsSync(join(cwd, f)))
  const qgHook = findQgHook(home)
  const steps = []

  const gate = (id, present, file, args) => {
    if (!present) { steps.push({ id, status: "not_applicable", detail: "comando/arquivo ausente" }); return }
    try { exec(file, args, { cwd }); steps.push({ id, status: "passed" }) }
    catch (e) { steps.push({ id, status: "failed", detail: (e.message || "falhou").split("\n")[0].slice(0, 160) }) }
  }

  // 1. deps do projeto (só no profile full)
  if (profile === "full") gate("deps", hasPkg, "npm", ["install"])
  // 2. lint
  gate("lint", !!scripts.lint, "npm", ["run", "lint"])
  // 3. typecheck (full)
  if (profile === "full") gate("typecheck", !!scripts.typecheck, "npm", ["run", "typecheck"])
  // 4. testes (npm test → pytest → NA)
  if (scripts.test) gate("test", true, "npm", ["test"])
  else if (hasPyTests) gate("test", true, pyBin, ["-m", "pytest", "-q"])
  else steps.push({ id: "test", status: "not_applicable", detail: "sem suíte de testes" })
  // 5. build (full)
  if (profile === "full") gate("build", !!scripts.build, "npm", ["run", "build"])
  // 6. Quality Gate L1
  gate("qg-l1", !!qgHook, pyBin, [qgHook || "", "--path", ".", "--level", "1"])
  // 7. runtime/preview — roadmap (não implementados)
  steps.push({ id: "runtime:start", status: "pending_feature" })
  steps.push({ id: "preview:open", status: "pending_feature" })

  const failed = steps.filter((s) => s.status === "failed").map((s) => s.id)
  return { profile, ready: failed.length === 0, steps, failed }
}
