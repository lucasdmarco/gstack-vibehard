import { execFileSync } from "child_process"

/**
 * Verify seletivo por arquivos alterados (PRD18 Sprint 1 §4). Gate RÁPIDO e
 * determinístico sobre o que mudou (git status): syntax-check por arquivo JS,
 * testes só dos arquivos de teste alterados, py_compile nos .py. HONESTO:
 *  - NÃO substitui o release gate (`verify --profile release` continua fail-closed);
 *  - sem git / erro de mapeamento → `fallback: "full"` (o chamador roda o completo);
 *  - nada alterado → `clean` (não inventa trabalho).
 */

export function detectChangedFiles(cwd, exec = execFileSync) {
  try {
    const out = String(exec("git", ["status", "--porcelain"], { cwd, stdio: "pipe", shell: false, encoding: "utf-8", timeout: 15000 }) || "")
    const files = out.split("\n").filter(Boolean)
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""))
      // rename "a -> b": o alvo é o que interessa
      .map((f) => (f.includes(" -> ") ? f.split(" -> ")[1] : f))
    return { ok: true, files }
  } catch { return { ok: false, files: [] } }
}

/** Classificação determinística dos alterados → quais checks se aplicam. */
export function mapChecks(files) {
  const js = files.filter((f) => /\.(mjs|cjs|js)$/i.test(f))
  const tests = js.filter((f) => /(^|\/)tests?\//.test(f) && /\.test\./.test(f))
  const srcJs = js.filter((f) => !tests.includes(f))
  const py = files.filter((f) => /\.py$/i.test(f))
  const docsOnly = files.length > 0 && files.every((f) => /\.(md|txt|json|jsonc|yml|yaml)$/i.test(f))
  return { js, tests, srcJs, py, docsOnly }
}

function runStep(steps, exec, cwd, id, file, args, detail) {
  try {
    exec(file, args, { cwd, stdio: "pipe", shell: false, timeout: 300000 })
    steps.push({ id, status: "passed", detail })
  } catch (e) {
    steps.push({ id, status: "failed", detail: String(e.message || "falhou").split("\n")[0].slice(0, 160) })
  }
}

const NOTE = "gate seletivo por arquivos alterados — NÃO substitui `verify --profile release` (fail-closed)"

function result(status, files, steps, extra = {}) {
  return { mode: "changed_files", status, files, steps, note: NOTE, ...extra }
}

/** Roda os checks mapeados. Muta `steps`. */
function runMappedChecks(m, steps, exec, cwd) {
  for (const f of m.js) runStep(steps, exec, cwd, `syntax:${f}`, process.execPath, ["--check", f], "node --check")
  if (m.tests.length) runStep(steps, exec, cwd, "tests:changed", process.execPath, ["--test", ...m.tests], `${m.tests.length} arquivo(s) de teste alterado(s)`)
  for (const f of m.py) runStep(steps, exec, cwd, `py:${f}`, "python", ["-m", "py_compile", f], "py_compile")
}

/**
 * Roda o gate seletivo. @returns {{ mode, status, files, steps, failed?, fallback?, note }}
 * status: "clean" | "ready" | "blocked" | "fallback".
 */
export function runChangedFilesVerify({ cwd = process.cwd(), exec = execFileSync } = {}) {
  const det = detectChangedFiles(cwd, exec)
  if (!det.ok) return result("fallback", [], [], { fallback: "full", note: "git indisponível — mapeamento incerto; rode o verify completo" })
  if (det.files.length === 0) return result("clean", [], [])
  const m = mapChecks(det.files)
  if (m.docsOnly) return result("ready", det.files, [{ id: "docs-only", status: "passed", detail: "só docs/config — sem gates de código aplicáveis" }])
  const steps = []
  runMappedChecks(m, steps, exec, cwd)
  const failed = steps.filter((s) => s.status === "failed").map((s) => s.id)
  return result(failed.length ? "blocked" : "ready", det.files, steps, { failed })
}
