#!/usr/bin/env node
/**
 * PRD51 S51.9.4 — DETECTOR DE TESTE INVISÍVEL.
 *
 * Achado que motivou o script (S51.9.3): um teste que sequestra
 * `process.stdout.write` global engole a saída do PRÓPRIO test runner. Escrevi
 * 9 testes num arquivo, o runner reportou 7, com ZERO falhas aparentes. Não
 * havia nada vermelho para notar — os dois testes simplesmente sumiram do
 * placar. Um teste que some assim pode estar escondendo uma falha real hoje.
 *
 * Como detecta (empírico, não heurística): conta as declarações `test(` no
 * arquivo e compara com o total que o `node --test` REPORTA ao rodar aquele
 * arquivo. Divergência = teste invisível.
 *
 * Uso:
 *   node scripts/check-test-visibility.mjs            # varre tests/ inteiro
 *   node scripts/check-test-visibility.mjs a.test.js  # arquivos específicos
 *   node scripts/check-test-visibility.mjs --json
 *
 * Sai 1 se algum arquivo esconder teste.
 */
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return e.name.endsWith(".test.js") ? [p] : []
  })
}

/**
 * Conta `test("...")` / `test('...')` no início de linha (top-level). Ignora
 * `test.skip`/`test.todo` — esses não entram na contagem de `tests` do runner
 * da mesma forma — e ignora ocorrências dentro de string/comentário por exigir
 * início de linha.
 */
export function staticTestCount(source) {
  return (source.match(/^test\s*\(\s*["'`]/gm) || []).length
}

/** Total que o runner REPORTA para o arquivo. `null` se não deu para ler. */
export function reportedTestCount(file) {
  const r = spawnSync(process.execPath, ["--test", file], {
    cwd: repoRoot, encoding: "utf-8", timeout: 600000, stdio: ["ignore", "pipe", "pipe"],
  })
  const out = `${r.stdout || ""}${r.stderr || ""}`.replace(/\[[0-9;]*m/g, "")
  const m = out.match(/^\W*tests (\d+)$/m)
  return { count: m ? Number(m[1]) : null, exitCode: r.status ?? null }
}

export function checkFile(file) {
  const declared = staticTestCount(readFileSync(file, "utf-8"))
  const { count: reported, exitCode } = reportedTestCount(file)
  const rel = path.relative(repoRoot, file).replace(/\\/g, "/")
  const hidden = reported === null ? null : declared - reported
  return { file: rel, declared, reported, hidden, exitCode, ok: hidden === 0 }
}

const resolveTargets = (argv) => {
  const targets = argv.filter((a) => !a.startsWith("--"))
  return targets.length ? targets.map((t) => path.resolve(repoRoot, t)) : walk(path.join(repoRoot, "tests"))
}

export function buildVisibilityReport(files) {
  const results = files.map(checkFile)
  const offenders = results.filter((r) => r.hidden !== null && r.hidden > 0)
  const unreadable = results.filter((r) => r.reported === null)
  return {
    schemaVersion: "gstack.test-visibility.v1",
    checked: results.length, offenders, unreadable,
    ok: offenders.length === 0,
  }
}

function renderVisibility(report) {
  console.log(`test-visibility: ${report.checked} arquivo(s) checado(s)`)
  for (const o of report.offenders) console.log(`  ✗ ${o.file}: declara ${o.declared}, reporta ${o.reported} — ${o.hidden} teste(s) INVISÍVEL(EIS)`)
  for (const u of report.unreadable) console.log(`  ? ${u.file}: não consegui ler o total reportado (exit ${u.exitCode})`)
  if (report.ok) console.log("  ✓ nenhum teste some do placar")
}

function main(argv) {
  const report = buildVisibilityReport(resolveTargets(argv))
  if (argv.includes("--json")) process.stdout.write(JSON.stringify(report) + "\n")
  else renderVisibility(report)
  return report.ok ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("check-test-visibility.mjs")) {
  process.exit(main(process.argv.slice(2)))
}
