import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "context.js")
const imp = () => import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)

// Monta um projeto com o layout REAL (.docs/PLANS, .docs/ADRS) + arquivos-raiz.
async function seedProject() {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cidx4-"))
  await mkdir(path.join(cwd, ".docs", "PLANS"), { recursive: true })
  await mkdir(path.join(cwd, ".docs", "ADRS"), { recursive: true })
  await writeFile(path.join(cwd, ".docs", "PLANS", "prd18.md"),
    "# PRD 18\n\n## Non-goals\nNunca ler `.env`.\n\n## Decisão\nEscolhemos worktree isolada porque evita tocar o branch principal.\n")
  await writeFile(path.join(cwd, ".docs", "PLANS", "plan-x.md"), "# Plano X\nPassos normais sem decisão.\n")
  await writeFile(path.join(cwd, ".docs", "ADRS", "adr001.md"), "# ADR 001\nRationale: preferimos SQLite/FTS local.\n")
  await writeFile(path.join(cwd, "README.md"), "# Projeto\nOverview.\n")
  await writeFile(path.join(cwd, "CLAUDE.md"), "# CLAUDE\nInstruções do harness.\n")
  await writeFile(path.join(cwd, "CHANGELOG.md"), "# Changelog\n## [1.0.0]\nprimeira versão.\n")
  return cwd
}

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  return { restore: () => { process.stdout.write = orig }, get: () => buf }
}

test("PRD24 24.4: .docs/RESEARCH indexa como 'research' e `search PRD22` acha o doc", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cidx24-"))
  try {
    await mkdir(path.join(cwd, ".docs", "PLANS"), { recursive: true })
    await mkdir(path.join(cwd, ".docs", "RESEARCH"), { recursive: true })
    await writeFile(path.join(cwd, ".docs", "PLANS", "prd22.md"), "# PRD22\n\nPRD22 sobre economia real de tokens.\n")
    await writeFile(path.join(cwd, ".docs", "RESEARCH", "registry.md"), "# Registry\nrepositorios comparados AIDD.\n")
    const { contextCommand } = await imp()
    await contextCommand(["index", "--reindex"], { cwd })

    const s = captureStdout()
    try { await contextCommand(["status", "--db"], { cwd }) } finally { s.restore() }
    assert.match(s.get(), /research=1/, ".docs/RESEARCH conta como fonte research")
    assert.match(s.get(), /prd=1/, "prd22.md classificado como prd")

    const q = captureStdout()
    try { await contextCommand(["search", "PRD22", "--json"], { cwd }) } finally { q.restore() }
    const parsed = JSON.parse(q.get().trim())
    const hits = parsed.results || parsed
    assert.ok(Array.isArray(hits) && hits.length >= 1, "search PRD22 retorna ≥1 (Métrica §11)")
    assert.ok(hits.some((r) => /prd22\.md$/.test(String(r.path).replace(/\\/g, "/"))))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("context index cobre .docs/PLANS/.docs/ADRS + raiz; status --db conta por fonte", async () => {
  const cwd = await seedProject()
  try {
    const { contextCommand } = await imp()
    await contextCommand(["index", "--reindex"], { cwd })
    const cap = captureStdout()
    try { await contextCommand(["status", "--db"], { cwd }) } finally { cap.restore() }
    const out = cap.get()
    // fontes reais indexadas (antes só README/CHANGELOG apareciam)
    assert.match(out, /por fonte/, "status --db mostra contagem por fonte")
    assert.match(out, /prd=1/, "prd18.md classificado como fonte prd pelo nome")
    assert.match(out, /adr=1/, "adr001.md como fonte adr")
    assert.match(out, /plans=1/, "plan-x.md como fonte plans")
    assert.match(out, /readme=1/, "README indexado")
    assert.match(out, /repo=1/, "CLAUDE.md indexado como repo")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("context scout --mode decision_context --json: decisão + evidência + arquivo + linhas + tokenAccounting", async () => {
  const cwd = await seedProject()
  try {
    const { contextCommand } = await imp()
    await contextCommand(["index", "--reindex"], { cwd })
    const cap = captureStdout()
    try { await contextCommand(["scout", "worktree", "--mode", "decision_context", "--json"], { cwd }) } finally { cap.restore() }
    const parsed = JSON.parse(cap.get().trim()) // JSON PURO
    assert.equal(parsed.mode, "decision_context")
    assert.equal(parsed.tokenAccounting.isEstimate, true, "tokenAccounting declara estimativa")
    assert.ok(Array.isArray(parsed.results))
    const hit = parsed.results.find((r) => /prd18\.md$/.test(r.file.replace(/\\/g, "/")))
    assert.ok(hit, "acha a decisão da worktree no prd18.md")
    assert.ok(typeof hit.lineStart === "number" && typeof hit.lineEnd === "number", "traz as linhas")
    assert.equal(hit.backend, "scan")
    assert.ok(hit.decision && hit.decision.length > 0, "tem o título da decisão")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("context scout normal (--json) inclui tokenAccounting.isEstimate", async () => {
  const cwd = await seedProject()
  try {
    const { contextCommand } = await imp()
    await contextCommand(["index", "--reindex"], { cwd })
    const cap = captureStdout()
    try { await contextCommand(["scout", "worktree", "--json"], { cwd }) } finally { cap.restore() }
    const parsed = JSON.parse(cap.get().trim())
    assert.equal(parsed.tokenAccounting.isEstimate, true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
