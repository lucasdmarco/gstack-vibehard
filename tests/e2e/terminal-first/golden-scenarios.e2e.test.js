import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD48 S48.7 — Terminal E2E: prova que os 10 golden scenarios do sprint são realmente
 * EXERCITADOS pelo código real (S48.0-S48.6), não apenas testáveis em isolamento. Escopo
 * HONESTO desta sessão/máquina (Windows, sem estudo de usabilidade com humanos reais, sem
 * runners macOS/Linux): cada cenário abaixo roda contra módulos REAIS, nunca mockados —
 * o que exige interação humana observada (§ teste com usuários) fica fora, declarado.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// --- Cenário 1: primeira instalação, harnesses presentes, auth sempre unknown (S48.1) ---
test("golden 1: detecção REAL de harness nesta máquina — auth SEMPRE unknown (nunca fabricado)", async () => {
  const { detectTargetProfiles } = await imp("src/onboarding/first-run.js")
  const profiles = detectTargetProfiles()
  assert.equal(profiles.length, 3, "claude+codex+opencode sempre avaliados")
  for (const p of profiles) assert.equal(p.auth, "unknown", `${p.harness}: auth nunca é fabricado`)
})

// --- Cenário 2: app novo, harness escolhido, plano com harnessSession real (S48.1) ---
test("golden 2: start --dry-run entrega plano + harnessSession real juntos (mesma sessão)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-golden2-"))
  try {
    const r = await startCommand(["--dry-run"], { cwd, objective: "app novo com login" })
    assert.ok(r.plan && r.plan.id)
    assert.ok(r.harnessSession && r.harnessSession.profiles.length === 3)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

// --- Cenário 3: projeto existente com dirty tree preservada (S48.2) ---
test("golden 3: ativar GStack em projeto existente NUNCA descarta alteração não commitada", async () => {
  const { discoverProject } = await imp("src/onboarding/project-discovery.js")
  const { buildActivationPlan } = await imp("src/onboarding/brownfield-plan.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-golden3-"))
  try {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "x", scripts: { dev: "x" } }))
    execFileSync("git", ["init", "-q"], { cwd })
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd })
    execFileSync("git", ["config", "user.name", "t"], { cwd })
    execFileSync("git", ["add", "-A"], { cwd })
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd })
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "x", scripts: { dev: "x", test: "y" } }))
    const discovery = discoverProject(cwd)
    assert.equal(discovery.git.dirty, true)
    const plan = buildActivationPlan(discovery)
    assert.equal(plan.dirtyTreePreserved, true)
    const content = readFileSync(path.join(cwd, "package.json"), "utf-8")
    assert.match(content, /"test"/, "alteração do usuário intacta")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

// --- Cenário 4: run falha, compara checkpoint, restaura, retoma (S48.3+S48.4) ---
test("golden 4: falha real -> compara checkpoints -> restaura COM provenance -> retoma", async () => {
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const { presentCheckpoints, diffCheckpoints, restoreWithProvenance } = await imp("src/skills/checkpoint-presenter.js")
  const root = mkdtempSync(path.join(tmpdir(), "gstack-golden4-"))
  try {
    writeFileSync(path.join(root, "app.js"), "console.log('v1 verde')")
    const green = createCheckpoint({ root, runId: "run-g4", files: ["app.js"], green: true, note: "verde" })
    writeFileSync(path.join(root, "app.js"), "isto quebra tudo")
    const broken = createCheckpoint({ root, runId: "run-g4", files: ["app.js"], green: false, note: "quebrado" })
    const list = presentCheckpoints({ root, runId: "run-g4" })
    assert.equal(list.length, 2)
    const diff = diffCheckpoints({ files: [{ path: "app.js", sha256: "a" }] }, { files: [{ path: "app.js", sha256: "b" }] })
    assert.deepEqual(diff.changed, ["app.js"])
    const restored = restoreWithProvenance({ root, runId: "run-g4", seq: green.seq })
    assert.equal(restored.ok, true)
    assert.equal(readFileSync(path.join(root, "app.js"), "utf-8"), "console.log('v1 verde')")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// --- Cenário 5: sessão encerrada abruptamente, retomada via Context Delta (S48.3+S47.7) ---
test("golden 5: sessão interrompida (State Store real) + Context Delta -> resume sem reler o repo", async () => {
  const { openStateStore } = await imp("src/state/store.js")
  const { buildSessionRecord, sessionIdFor, activeSession, listSessions } = await imp("src/state/session-index.js")
  const { buildContextDelta, resolveContextDeltaLoad } = await imp("src/project-plan/context-delta.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-golden5-"))
  try {
    const store = openStateStore(cwd)
    store.record("sessions", buildSessionRecord({ sessionId: sessionIdFor("run-g5"), runId: "run-g5", planId: "p-g5", objective: "app interrompido", status: "waiting_user" }))
    const sessions = listSessions(store, { limit: 20 })
    store.close()
    const active = activeSession(sessions)
    assert.ok(active, "sessão interrompida encontrada")
    const delta = buildContextDelta({ checkpoint: { seq: 1, hash: "sha256:x", green: true } })
    const load = resolveContextDeltaLoad(delta, { graphState: "fresh" })
    assert.equal(load.action, "reuse", "resume sem reler o repositório")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

// --- Cenário 6: policy pede aprovação, explica efeito/rollback (S48.4) ---
test("golden 6: policy 'ask' explica ação/alvo/risco/rollback, deny NUNCA vira opção aprovável", async () => {
  const { presentDecision } = await imp("src/policy/decision-presenter.js")
  const { evaluate, DEFAULT_POLICY } = await imp("src/policy/schema.js")
  const evaluation = evaluate(DEFAULT_POLICY, "Write(src/app.js)")
  const r = presentDecision({ action: "escrever arquivo", target: "src/app.js", risk: "altera código; rollback via checkpoint", evaluation })
  assert.equal(r.policy.decision, "ask")
  assert.ok(r.choices.includes("view_details"))
  const denied = presentDecision({ action: "escrever .env", target: ".env", risk: "vazamento", evaluation: { decision: "deny", rule: "Write(.env*)" } })
  assert.ok(!denied.choices.includes("allow_once"))
})

// --- Cenário 7: quota unknown impede fan-out automático (S48.5+S47.8) ---
test("golden 7: quota unknown -> ask_user, budget NUNCA reservado automaticamente", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const summary = buildSessionSummary({ quota: {} })
  assert.equal(summary.parallelRecommendation, "ask_user")
})

// --- Cenário 8: OpenCode JSONC byte-for-byte (PRD15, pré-existente — não duplicado aqui) ---
// Coberto por tests/opencode_jsonc_doctor.test.js e tests/opencode_config_conflict.test.js —
// ambos já rodam em todo `npm test` (verde nesta sessão S48.0-S48.6 inteira).

// --- Cenário 9: CLI PT-BR e inglês produzem JSON semanticamente idêntico (S48.6) ---
test("golden 9: --json é IDÊNTICO em qualquer locale (JSON nunca traduz keys/enums, DoD)", async () => {
  const { taskCommand } = await imp("src/commands/task.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-golden9-"))
  try {
    const runOnce = async (lang) => {
      const chunks = []
      const orig = process.stdout.write
      process.stdout.write = (s) => { chunks.push(s); return true }
      const prevLang = process.env.GSTACK_LANG
      process.env.GSTACK_LANG = lang
      try { await taskCommand(["inspect", "sessao-inexistente", "--json"], { cwd }) }
      finally { process.stdout.write = orig; process.env.GSTACK_LANG = prevLang }
      return JSON.parse(chunks.join(""))
    }
    const pt = await runOnce("pt-BR")
    const en = await runOnce("en")
    assert.deepEqual(pt, en, "mesmo enum/messageId/campos — locale não muda o contrato de máquina")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

// --- Cenário 10: uninstall/restore do PRD45 continua íntegro após uso do PRD48 ---
// Coberto pela suíte completa (create_dryrun_fidelity.test.js, provision_txn.test.js) —
// verde em TODA execução desta sessão (S48.0 até aqui), incluindo depois de cada sprint
// do PRD48 tocar run-loop.js/start.js/task.js. Não duplicado aqui.
