import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const mod = path.resolve(import.meta.dirname, "..", "src", "vfa", "challenge.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("classifyRisk: pega escrita em config global, segredo, MCP global, destrutivo", async () => {
  const { classifyRisk } = await imp()
  assert.equal(classifyRisk({ intent: "edit_file", target: { scope: "global", pathOrName: "~/.config/opencode/opencode.jsonc" } }).level, "high")
  assert.equal(classifyRisk({ intent: "read_secret" }).level, "high")
  assert.equal(classifyRisk({ intent: "call_mcp", target: { scope: "global" } }).level, "high")
  assert.equal(classifyRisk({ intent: "run_command", target: { pathOrName: "rm -rf /" } }).level, "high")
  // baixo risco: edição de arquivo do projeto
  assert.equal(classifyRisk({ intent: "edit_file", target: { scope: "project", pathOrName: "src/a.js" } }).level, "low")
})

// ── DoD (PRD §10.5): editar config global de harness SEM backup/manifest/rollback → DENY (hook real) ──
test("evaluateChallenge: alto risco sem evidência completa → DENY; com evidência → allow", async () => {
  const { evaluateChallenge } = await imp()
  const action = { intent: "edit_file", target: { scope: "global", pathOrName: "~/.config/opencode/opencode.jsonc" } }
  const deny = evaluateChallenge(action, { evidence: {} }, { enforcement: "real_hooks" })
  assert.equal(deny.decision, "deny")
  assert.deepEqual(deny.missing.sort(), ["backup-path", "install-manifest-owner", "rollback-plan"])

  const partial = evaluateChallenge(action, { evidence: { "backup-path": "x" } }, { enforcement: "real_hooks" })
  assert.equal(partial.decision, "deny", "evidência parcial ainda nega")

  const ok = evaluateChallenge(action, { evidence: { "install-manifest-owner": "y", "backup-path": "x", "rollback-plan": "z" } }, { enforcement: "real_hooks" })
  assert.equal(ok.decision, "allow")
})

// ── harness instrucional NÃO bloqueia antes → posthoc_audit_only (não é Zero-Trust) ──
test("evaluateChallenge: harness instrucional → posthoc_audit_only (sem bloqueio pré-ação)", async () => {
  const { evaluateChallenge } = await imp()
  const action = { intent: "read_secret" }
  const r = evaluateChallenge(action, { evidence: {} }, { enforcement: "instructional" })
  assert.equal(r.decision, "posthoc_audit_only")
  assert.match(r.note, /não bloqueia|posterior/i)
})

// ── ABUSO de parsing: cmd.exe/PowerShell quebra `a,b,c` em args separados ──
test("challengeCommand: --evidence aceita tokens por ESPAÇO (cmd/PS split) e por vírgula", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const cmd = await import(`${pathToFileURL(path.resolve(import.meta.dirname, "..", "src", "commands", "challenge.js"))}?t=${Date.now()}`)
  const dir = await mkdtemp(path.join((await import("node:os")).tmpdir(), "gstack-ch-"))
  const prevCode = process.exitCode
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = () => true
  try {
    const base = ["evaluate", "--intent", "edit_file", "--target", "~/.config/opencode/x", "--scope", "global", "--harness", "claude"]
    const spaced = cmd.challengeCommand([...base, "--evidence", "install-manifest-owner", "backup-path", "rollback-plan", "--json"], { cwd: dir })
    assert.equal(spaced.decision, "allow", "evidência por espaço (cmd/PS) → allow")
    const comma = cmd.challengeCommand([...base, "--evidence", "install-manifest-owner,backup-path,rollback-plan", "--json"], { cwd: dir })
    assert.equal(comma.decision, "allow", "evidência por vírgula (bash) → allow")
    const none = cmd.challengeCommand([...base, "--json"], { cwd: dir })
    assert.equal(none.decision, "deny", "sem evidência → deny")
  } finally {
    process.stdout.write = orig
    process.exitCode = prevCode
    await rm(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

test("buildChallenge: monta o desafio com a evidência exigida (só p/ alto risco)", async () => {
  const { buildChallenge } = await imp()
  const ch = buildChallenge({ intent: "edit_file", target: { scope: "global", pathOrName: "~/.claude/settings.json" } })
  assert.ok(ch.requiredEvidence.includes("rollback-plan"))
  assert.equal(buildChallenge({ intent: "edit_file", target: { scope: "project", pathOrName: "a.js" } }), null)
})
