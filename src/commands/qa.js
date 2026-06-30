import { execFileSync } from "child_process"
import { readFileSync } from "fs"
import { join } from "path"
import { runQaLenses, evaluateQa } from "../project-plan/qa-lenses.js"
import { diffHygiene } from "../project-plan/diff-hygiene.js"
import { isGitRepo } from "../delegation/worktree.js"
import { section, success, warn, error, info } from "../cli/index.js"

function changedFiles(cwd, exec) {
  try {
    const out = String(exec("git", ["status", "--porcelain"], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15000 }) || "")
    return out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.split(" -> ").pop())
  } catch { return [] }
}

/**
 * `gstack_vibehard qa [--strict] [--json]` — QA Multi-Lens determinístico sobre os
 * arquivos MUDADOS (git). Combina o `diff-hygiene` (segredo/debugger) com as lentes
 * (eval/any/bare-except/query-sem-limit/shell). ALTO/CRÍTICO bloqueiam; MÉDIO bloqueia
 * em `--strict`. Veredito DETERMINÍSTICO (LLM seria só sinal). io injetável p/ teste.
 */
export function qaCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const strict = args.includes("--strict")
  const exec = opts.exec || ((f, a, o) => execFileSync(f, a, { stdio: "pipe", encoding: "utf-8", timeout: 30000, ...o }))

  if (!opts.files && !isGitRepo(cwd, exec)) {
    if (json) { process.stdout.write('{"error":"not_a_git_repo"}\n'); return }
    error("`qa` precisa de um repositório git (varre os arquivos mudados)."); return
  }

  const changed = opts.changed || changedFiles(cwd, exec)
  const files = opts.files || changed.map((rel) => { try { return { rel, content: readFileSync(join(cwd, rel), "utf-8") } } catch { return null } }).filter(Boolean)

  const lensFindings = runQaLenses(files)
  // diff-hygiene roda sobre os MESMOS arquivos; só os HIGH (debugger/segredo/.only) entram como ALTO
  const hy = diffHygiene({ cwd, exec, files: files.map((f) => f.rel) })
  const hygieneHigh = (hy.findings || []).filter((f) => f.severity === "HIGH")
    .map((f) => ({ file: f.file, id: f.rule, lens: "hygiene", severity: "ALTO", line: f.line, msg: f.message }))
  const findings = [...lensFindings, ...hygieneHigh]
  const gate = evaluateQa(findings, { strict })

  if (json) { process.stdout.write(JSON.stringify({ ...gate, findings }) + "\n"); if (gate.blocked) process.exitCode = 1; return }

  section("qa — multi-lens (determinístico)")
  if (findings.length === 0) { success("Limpo — nenhuma lente disparou nos arquivos mudados."); return }
  for (const f of findings) {
    const fn = (f.severity === "CRITICO" || f.severity === "ALTO") ? error : (f.severity === "MEDIO" ? warn : info)
    fn(`  [${f.severity}] ${f.lens}/${f.id} — ${f.file}:${f.line} ${f.msg}`)
  }
  info(`  Por lente: ${JSON.stringify(gate.byLens)}`)
  if (gate.blocked) { error(`BLOQUEADO: ${gate.critical} crít · ${gate.high} alto${strict ? ` · ${gate.medium} médio (strict)` : ""}. Corrija antes de entregar.`); process.exitCode = 1 }
  else warn(`Avisos: ${gate.medium} médio · ${gate.low} baixo (não bloqueia${strict ? "" : "; `--strict` bloqueia médio"}).`)
}
