#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * PROVA DE MÁQUINA LIMPA — um comando, placar completo (pós-PRD25, 3ª revisão).
 *
 * Uso (na máquina limpa): git clone → npm ci → `npm run proof` (ou
 * `node scripts/clean-machine-proof.mjs`). Roda TODOS os gates na ordem, imprime
 * PASS/FAIL por etapa e grava o relatório em .gstack/reports/clean-machine-proof.json.
 * Exit 0 só com TUDO verde. Honesto: nenhuma etapa vira skip silencioso.
 *
 * Config: GSTACK_PROOF_E2E_ROUNDS (default 12) · GSTACK_VERIFY_TEST_TIMEOUT_MS
 * (repassado ao verify p/ máquinas muito lentas).
 */

const isWin = process.platform === "win32"
const results = []

const defaultCheck = (r) => ({ ok: r.status === 0 })
function buildEntry(name, secs, checked, r) {
  const detail = checked.detail || (checked.ok ? "" : failDetail(r))
  const entry = { name, ok: !!checked.ok, seconds: Number(secs), detail }
  if (!entry.ok) entry.log = saveFailLog(name, r) // post-mortem completo, não só 1 linha
  return entry
}
function printEntry(entry) {
  const tail = (entry.detail ? ` — ${entry.detail}` : "") + (entry.log ? `\n    log completo: ${entry.log}` : "")
  console.log(`${entry.ok ? "PASS" : "FAIL"} (${entry.seconds}s)${tail}`)
}
function run(name, file, args, { timeoutMs = 900000, expect } = {}) {
  const t0 = Date.now()
  process.stdout.write(`▸ ${name} ... `)
  const r = spawnSync(file, args, { encoding: "utf-8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"], shell: false })
  const entry = buildEntry(name, ((Date.now() - t0) / 1000).toFixed(0), (expect || defaultCheck)(r), r)
  results.push(entry)
  printEntry(entry)
  return r
}

// Falhou: extrai as linhas RELEVANTES (not ok/Error/✖), não a última linha qualquer.
function failDetail(r) {
  const all = `${r.stdout || ""}\n${r.stderr || ""}`
  const hits = all.split("\n").filter((l) => /not ok|✖|Error:|EBUSY|FAILED/.test(l))
  return (hits[0] || `exit ${r.status}`).trim().slice(0, 160)
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
function saveFailLog(name, r) {
  try {
    mkdirSync(join(".gstack", "reports"), { recursive: true })
    const p = join(".gstack", "reports", `proof-fail-${slug(name)}.log`)
    writeFileSync(p, `exit ${r.status}\n\n=== STDOUT ===\n${r.stdout || ""}\n=== STDERR ===\n${r.stderr || ""}`)
    return p
  } catch { return null }
}
// npm no Windows é shim .cmd → cmd.exe /c (execFileSync direto dá EINVAL/ENOENT).
const npmRun = (name, script, opts) => (isWin
  ? run(name, process.env.ComSpec || "cmd.exe", ["/c", "npm", "run", script], opts)
  : run(name, "npm", ["run", script], opts))

function parseJsonOut(r) {
  try { return JSON.parse(String(r.stdout || "").trim()) } catch { return null }
}

// ── Fase 1: determinismo EBUSY (o ponto contestado) ──────────────────────────
function phaseEbusyStress() {
  const rounds = Number(process.env.GSTACK_PROOF_E2E_ROUNDS) || 12
  let pass = 0
  const t0 = Date.now()
  process.stdout.write(`▸ runtime_e2e stress ${rounds}x ... `)
  for (let i = 0; i < rounds; i++) {
    const r = spawnSync(process.execPath, ["--test", "tests/runtime_e2e.test.js"], { encoding: "utf-8", timeout: 180000 })
    if (r.status === 0) pass++
  }
  const ok = pass === rounds
  results.push({ name: `runtime_e2e stress ${rounds}x`, ok, seconds: Math.round((Date.now() - t0) / 1000), detail: `${pass}/${rounds} — EBUSY = 0 exigido` })
  console.log(`${ok ? "PASS" : "FAIL"} (${pass}/${rounds})`)
}

// ── Fase 3: gates com validação de CONTEÚDO (não só exit code) ───────────────
function phaseContentGates() {
  run("qg --strict (0 findings)", pyBin(), ["hooks/hooks/qg.py", "--path", ".", "--level", "1", "--strict"], {
    expect: (r) => {
      const q = parseJsonOut(r)
      return { ok: r.status === 0 && q && q.pass === true, detail: q ? `findings=${(q.issues || []).length} blocking=${q.blocking_severity_count}` : "sem JSON" }
    },
  })
  run("dream audit (0 RISK)", process.execPath, ["src/index.js", "dream", "audit", "--json"], {
    expect: (r) => {
      const d = parseJsonOut(r)
      const s = d && d.summary
      return { ok: !!s && s.RISK === 0 && s.PLACEBO === 0, detail: s ? `REAL=${s.REAL} PARTIAL=${s.PARTIAL} RISK=${s.RISK}` : "sem JSON" }
    },
  })
  run("readiness (JSON válido, sem crash)", process.execPath, ["src/index.js", "tools", "readiness", "--json"], {
    expect: (r) => ({ ok: r.status === 0 && !!parseJsonOut(r), detail: warnNote(r) }),
  })
  run("conformance --strict", process.execPath, ["src/index.js", "doctor", "--conformance", "--strict", "--json"])
  run("agents build --check (sem drift)", process.execPath, ["scripts/scripts/build_agents.js", "--check"])
}
const warnNote = (r) => (/DeprecationWarning/i.test(String(r.stderr || "")) ? "WARNING no stderr (não pode!)" : "stderr limpo")
const pyBin = () => (isWin ? "python" : "python3")

// ── Fase 4: o carimbo ─────────────────────────────────────────────────────────
function phaseVerifyRelease() {
  run("verify --profile release (READY)", process.execPath, ["src/index.js", "verify", "--profile", "release", "--json"], {
    timeoutMs: 1800000,
    expect: (r) => {
      const v = parseJsonOut(r)
      return { ok: !!v && v.status === "ready" && v.ready === true, detail: v ? `status=${v.status} failed=${JSON.stringify(v.failed)} timedOut=${JSON.stringify(v.timedOut)}` : "sem JSON" }
    },
  })
}

// ── main ──────────────────────────────────────────────────────────────────────
console.log("═══ PROVA DE MÁQUINA LIMPA — gstack_vibehard ═══\n")
phaseEbusyStress()
npmRun("npm test (suíte completa)", "test")
npmRun("test:py", "test:py")
npmRun("lint", "lint")
npmRun("typecheck", "typecheck")
npmRun("typecheck:ts", "typecheck:ts")
phaseContentGates()
phaseVerifyRelease()
npmRun("test:pack (tarball real)", "test:pack", { timeoutMs: 600000 })
run("tools clean-machine (12 cenários)", process.execPath, ["src/index.js", "tools", "clean-machine", "--json"])
run("uninstall --dry-run (só plano)", process.execPath, ["src/index.js", "uninstall", "--dry-run"])

const failed = results.filter((r) => !r.ok)
const total = results.reduce((a, r) => a + r.seconds, 0)
console.log("\n═══ PLACAR ═══")
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`)
console.log(`\n${failed.length === 0 ? "✅ TUDO VERDE" : `❌ ${failed.length} FALHA(S)`} · ${results.length} etapas · ${Math.round(total / 60)}min`)

try {
  mkdirSync(join(".gstack", "reports"), { recursive: true })
  writeFileSync(join(".gstack", "reports", "clean-machine-proof.json"), JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, results }, null, 2) + "\n")
  console.log("Relatório: .gstack/reports/clean-machine-proof.json")
} catch { /* relatório é best-effort */ }
process.exit(failed.length === 0 ? 0 : 1)
