import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execFileSync } from "child_process"
import { isStrongTrust } from "../dream/capabilities.js"

/**
 * Delivery gates HONESTOS (PRD Fase 3 §6). Orquestra só os gates que existem;
 * o que falta é classificado com precisão — nunca "sucesso silencioso".
 *
 * Status por gate: passed | failed | not_applicable | tool_missing | pending_feature
 * Status do run:
 *   blocked             = algum gate OBRIGATÓRIO falhou.
 *   pending_product     = runtime/preview pendente E o projeto precisa rodar (start/dev).
 *   ready_with_warnings = passou, mas faltou ferramenta esperada (ex.: Fallow/QG ausente).
 *   ready               = tudo aplicável passou, sem avisos.
 * `reducedTrust` = harness ativo não tem controle real (best_effort/partial).
 */

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return {} } }

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
  const hasRunScript = !!(scripts.start || scripts.dev) // projeto que "roda" (app/web)
  const qgHook = findQgHook(home)
  const steps = []

  const run = (id, file, args, { required = false } = {}) => {
    try { exec(file, args, { cwd }); steps.push({ id, status: "passed", required }) }
    catch (e) { steps.push({ id, status: "failed", required, detail: (e.message || "falhou").split("\n")[0].slice(0, 160) }) }
  }
  const na = (id, detail, required = false) => steps.push({ id, status: "not_applicable", required, detail })

  // 1. deps (full)
  if (profile === "full") { hasPkg ? run("deps", "npm", ["install"], { required: true }) : na("deps", "sem package.json") }
  // 2. lint (opcional)
  scripts.lint ? run("lint", "npm", ["run", "lint"]) : na("lint", "sem script lint")
  // 3. typecheck (full, opcional)
  if (profile === "full") { scripts.typecheck ? run("typecheck", "npm", ["run", "typecheck"]) : na("typecheck", "sem script typecheck") }
  // 4. testes (obrigatório quando existe; sem suíte = NA)
  if (scripts.test) run("test", "npm", ["test"], { required: true })
  else if (hasPyTests) run("test", pyBin, ["-m", "pytest", "-q"], { required: true })
  else na("test", "sem suíte de testes")
  // 5. build (full; obrigatório quando existe)
  if (profile === "full") { scripts.build ? run("build", "npm", ["run", "build"], { required: true }) : na("build", "sem script build") }
  // 6. Quality Gate L1/L2 — obrigatórios SE o hook existir; ausente = tool_missing (não sucesso).
  if (qgHook) {
    run("qg-l1", pyBin, [qgHook, "--path", ".", "--level", "1"], { required: true })
    run("qg-l2", pyBin, [qgHook, "--path", ".", "--level", "2"], { required: true })
  } else {
    steps.push({ id: "qg", status: "tool_missing", required: false, detail: "Fallow/QG não instalado" })
  }
  // 7. runtime/preview — roadmap. productCritical quando o projeto precisa rodar.
  steps.push({ id: "runtime:start", status: "pending_feature", productCritical: hasRunScript })
  steps.push({ id: "preview:open", status: "pending_feature", productCritical: hasRunScript })

  // Qualquer gate que FALHOU bloqueia "ready" (lint quebrado não é "pronto").
  const failed = steps.filter((s) => s.status === "failed").map((s) => s.id)
  const toolMissing = steps.filter((s) => s.status === "tool_missing").map((s) => s.id)
  const productPending = steps.some((s) => s.status === "pending_feature" && s.productCritical)

  let status
  if (failed.length) status = "blocked"
  else if (productPending) status = "pending_product"
  else if (toolMissing.length) status = "ready_with_warnings"
  else status = "ready"

  const reducedTrust = opts.harness ? !isStrongTrust(opts.harness) : false
  // ready (compat): sem blockers e sem pendência de produto.
  const ready = status === "ready" || status === "ready_with_warnings"

  return { profile, status, ready, reducedTrust, harness: opts.harness || null, steps, failed, toolMissing }
}
