import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const cassettesDir = path.join(repoRoot, "tests", "fixtures", "notebooklm", "scrubbed-cassettes")

/**
 * PRD49 S49.9 — NotebookLM connector experimental. `connect` é SEMPRE
 * interativo (nunca bypassável por --yes). Falhas de schema/quota/auth
 * degradam honestamente, nunca travam/fingem sucesso. Resultado importado
 * SEMPRE exige citação de fonte + aprovação explícita do usuário. Cassetes
 * VCR são escrubados de propósito — nenhum cookie/token/dado pessoal real.
 */

test("resolveConnectMode: SEMPRE interativo, --yes NUNCA bypassa", async () => {
  const { resolveConnectMode } = await imp("src/research/notebooklm-adapter.js")
  assert.equal(resolveConnectMode({ yes: true }), "interactive_required")
  assert.equal(resolveConnectMode({ yes: false }), "interactive_required")
  assert.equal(resolveConnectMode({}), "interactive_required")
})

test("classifyNotebookLMFailure: schema/quota/auth -> degraded_external_service honesto, nunca trava", async () => {
  const { classifyNotebookLMFailure } = await imp("src/research/notebooklm-adapter.js")
  for (const kind of ["schema", "quota", "auth"]) {
    const r = classifyNotebookLMFailure({ kind })
    assert.equal(r.status, "degraded_external_service")
    assert.equal(r.category, kind)
  }
})

test("classifyNotebookLMFailure: kind desconhecido -> ainda degrada honestamente, nunca finge sucesso", async () => {
  const { classifyNotebookLMFailure } = await imp("src/research/notebooklm-adapter.js")
  const r = classifyNotebookLMFailure({ kind: "nao-mapeado" })
  assert.equal(r.status, "degraded_external_service")
  assert.equal(r.category, "unknown")
})

test("validateImportRequiresCitationAndApproval: sem citação OU sem aprovação -> bloqueado", async () => {
  const { validateImportRequiresCitationAndApproval } = await imp("src/research/notebooklm-adapter.js")
  assert.equal(validateImportRequiresCitationAndApproval({ result: { sourceCitations: [] }, approved: true }).ok, false)
  assert.equal(validateImportRequiresCitationAndApproval({ result: { sourceCitations: ["doc.pdf p.3"] }, approved: false }).ok, false)
})

test("validateImportRequiresCitationAndApproval: citação E aprovação -> ok", async () => {
  const { validateImportRequiresCitationAndApproval } = await imp("src/research/notebooklm-adapter.js")
  const r = validateImportRequiresCitationAndApproval({ result: { sourceCitations: ["doc.pdf p.3"] }, approved: true })
  assert.equal(r.ok, true)
})

test("CONTROLE NEGATIVO: nunca importa cookie de browser automaticamente -- caminho de código nem existe, sempre recusa", async () => {
  const { attemptAutomaticCookieImport, AUTO_COOKIE_IMPORT_ENABLED } = await imp("src/research/notebooklm-adapter.js")
  assert.equal(AUTO_COOKIE_IMPORT_ENABLED, false)
  const r = attemptAutomaticCookieImport()
  assert.equal(r.ok, false)
  assert.equal(r.reason, "automatic_cookie_import_never_supported")
})

test("redactAuthLog: nunca loga estado de auth -- cookie/token/session removidos do texto", async () => {
  const { redactAuthLog } = await imp("src/research/notebooklm-adapter.js")
  const raw = "connecting with cookie=abc123; session_token=xyz789; auth_state=logged_in"
  const redacted = redactAuthLog(raw)
  assert.ok(!redacted.includes("abc123"))
  assert.ok(!redacted.includes("xyz789"))
  assert.ok(!/logged_in/.test(redacted))
})

test("PROVENANCE: nenhum cassete VCR escrubado contém cookie/token/dado pessoal real", async () => {
  const files = readdirSync(cassettesDir).filter((f) => f.endsWith(".json"))
  assert.ok(files.length >= 1, "pelo menos 1 cassete de fixture existe")
  const secretPatterns = [/cookie=/i, /session_token/i, /Bearer [A-Za-z0-9._-]{20,}/, /@gmail\.com/i]
  for (const f of files) {
    const content = readFileSync(path.join(cassettesDir, f), "utf-8")
    for (const rx of secretPatterns) assert.ok(!rx.test(content), `${f} não deve conter padrão sensível ${rx}`)
  }
})

test("NOTEBOOKLM_ADAPTER_SCHEMA: schema real declarado", async () => {
  const { NOTEBOOKLM_ADAPTER_SCHEMA } = await imp("src/research/notebooklm-adapter.js")
  assert.equal(NOTEBOOKLM_ADAPTER_SCHEMA, "gstack.notebooklm-adapter.v1")
})

test("doctorStatus: sem ambiente Python pinado configurado -> not_configured honesto, nunca finge conectado", async () => {
  const { doctorStatus } = await imp("src/research/notebooklm-adapter.js")
  const r = doctorStatus({ probe: () => ({ ok: false }) })
  assert.equal(r.status, "not_configured")
})

// --- CLI: `research notebooklm doctor|connect|query|import` ---
async function captureStdout(fn) {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await fn() } finally { process.stdout.write = orig }
  return out.trim().split("\n").pop()
}

test("CLI research notebooklm doctor --json: not_configured honesto (sem ambiente real)", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await captureStdout(() => researchCommand(["notebooklm", "doctor", "--json"], {}))
  assert.equal(JSON.parse(out).status, "not_configured")
})

test("CLI research notebooklm connect --json: SEMPRE interactive_required, mesmo com --yes", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await captureStdout(() => researchCommand(["notebooklm", "connect", "--json", "--yes"], {}))
  assert.equal(JSON.parse(out).mode, "interactive_required")
})

test("CLI research notebooklm import --json: sem --approved -> recusado, mesmo com citações no arquivo", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const fixturePath = path.join(repoRoot, "tests", "fixtures", "notebooklm", "import-with-citations.json")
  const fs = await import("node:fs")
  fs.writeFileSync(fixturePath, JSON.stringify({ sourceCitations: ["fonte-2.pdf p.14"] }))
  const prevExit = process.exitCode
  try {
    const out = await captureStdout(() => researchCommand(["notebooklm", "import", "--result", fixturePath, "--to", "context", "--json"], {}))
    const parsed = JSON.parse(out)
    assert.equal(parsed.ok, false)
    assert.equal(parsed.reason, "missing_user_approval")
  } finally { fs.rmSync(fixturePath, { force: true }); process.exitCode = prevExit }
})

test("CLI research notebooklm import --json: com --approved E citações -> ok", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const fixturePath = path.join(repoRoot, "tests", "fixtures", "notebooklm", "import-with-citations-2.json")
  const fs = await import("node:fs")
  fs.writeFileSync(fixturePath, JSON.stringify({ sourceCitations: ["fonte-2.pdf p.14"] }))
  try {
    const out = await captureStdout(() => researchCommand(["notebooklm", "import", "--result", fixturePath, "--to", "context", "--approved", "--json"], {}))
    const parsed = JSON.parse(out)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.to, "context")
  } finally { fs.rmSync(fixturePath, { force: true }) }
})
