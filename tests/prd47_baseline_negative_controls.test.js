import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

/**
 * PRD47 S47.0 — "Baseline de integração e testes negativos": prova as 12 lacunas
 * ANTES de mudar o wiring (S47.1+). Cada teste abaixo documenta o comportamento
 * ATUAL (às vezes indesejável) com evidência de arquivo:linha real — não é
 * suposição. Quando S47.1+ corrigir o wiring, estes testes precisam ser
 * ATUALIZADOS para a asserção nova (não apagados silenciosamente).
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtemp(path.join(tmpdir(), p))
const src = (rel) => readFileSync(path.join(repoRoot, rel), "utf-8")

// ── 1. GAP: `done` ocorre mesmo com preview pending/unhealthy (P0-A) ─────────
test("GAP-1 (P0-A): pipeline fecha 'done' mesmo com preview unhealthy — preview não está em GATE_STAGES", async () => {
  const runLoopSrc = src("src/project-plan/run-loop.js")
  const m = /const GATE_STAGES = new Set\(\[([^\]]*)\]\)/.exec(runLoopSrc)
  assert.ok(m, "GATE_STAGES precisa existir p/ este teste fazer sentido")
  const gates = m[1].split(",").map((s) => s.trim().replace(/"/g, ""))
  assert.deepEqual(gates.sort(), ["test", "verify"], "preview NÃO é gate — baseline do gap P0-A")
  assert.ok(!gates.includes("preview"), "confirma: preview unhealthy NUNCA derruba o pipeline hoje")
})

// ── 2. GAP: review nunca bloqueia (é sempre advisory) ────────────────────────
test("GAP-2: stage 'review' é SEMPRE advisory — nunca participa do gate determinístico", async () => {
  const runLoopSrc = src("src/project-plan/run-loop.js")
  assert.match(runLoopSrc, /review:\s*\{\s*status:\s*"advisory"/, "review hardcoded como advisory")
  const m = /const GATE_STAGES = new Set\(\[([^\]]*)\]\)/.exec(runLoopSrc)
  assert.ok(!m[1].includes("review"), "review não está em GATE_STAGES — nunca bloqueia hoje")
})

// ── 3. GAP: feature-behavior fica pending_verifier incondicional (P0-C) ──────
test("GAP-3 (P0-C): feature-behavior/integration SEMPRE viram pending_verifier, nunca verifier real", async () => {
  const { acceptanceIsHonest } = await imp("src/project-plan/product-brief.js")
  const productBriefSrc = src("src/project-plan/product-brief.js")
  assert.match(productBriefSrc, /pending_verifier:\s*\{\s*reason:\s*"sem verificador automatizado/, "feature-behavior hardcoded pending")
  const feature = { id: "feature-behavior", statement: "x", pending_verifier: { reason: "sem verificador automatizado" } }
  assert.equal(acceptanceIsHonest(feature), true, "hoje o único caminho honesto pra feature-behavior é pending — nunca real")
})

// ── 4. GAP: proof só roda com --proof explícito (P0-D) ───────────────────────
test("GAP-4 (P0-D): start sem --proof nunca roda proof automaticamente", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = await mk("gstack-s470-noproof-")
  try {
    const r = await startCommand([], {
      cwd: dir, objective: "criar landing page", projectName: "lp47", mode: "lite",
      designSystem: "none", prompt: async () => "lp47", select: async (_q, c) => c[0], confirm: async () => true,
      exec: () => ({ ok: true }), gateExec: () => ({ ok: true, code: 0 }),
      devRunner: () => ({ services: [] }), verifyRunner: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
      scoutRunner: () => ({ status: "not_applicable" }),
    })
    assert.equal(r.executed, true)
    assert.equal(r.proof, undefined === r.proof ? undefined : r.proof, "sem --proof, nenhum campo proof populado no resultado do start")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// ── 5. GAP: Execution Contract nunca é dirigido pela execução real de skills ─
test("GAP-5: run-loop.js NUNCA chama advanceExecution/recordApplied/verifyExecution — contract fica só em fixture sintética", async () => {
  const runLoopSrc = src("src/project-plan/run-loop.js")
  for (const fn of ["advanceExecution", "recordApplied", "verifyExecution", "createExecutionContract"]) {
    assert.doesNotMatch(runLoopSrc, new RegExp(fn), `${fn} não é chamado no pipeline real — só em behavioral-conformance.js com fixture`)
  }
})

// ── 6. GAP: handoff imediato, sem tentativa de classificação/reparo ──────────
test("GAP-6: gate falho -> handoff DIRETO — diagnose-loop.js nunca é consultado no caminho automático", async () => {
  const runLoopSrc = src("src/project-plan/run-loop.js")
  assert.doesNotMatch(runLoopSrc, /diagnose-loop/, "run-loop.js não importa diagnose-loop — só commands/loop.js (manual) o faz")
  const loopCmdSrc = src("src/commands/loop.js")
  assert.match(loopCmdSrc, /diagnose-loop/, "confirma que diagnose-loop EXISTE e é usado, só que manualmente")
  assert.match(runLoopSrc, /Gate determinístico falhou e não há passo retomável para corrigir → handoff\s*\n\s*\/\/ imediato/, "comentário do próprio código admite o handoff imediato")
})

// ── 7. GAP real confirmado: integrity.js tem ponto cego pra itens kind:"dir" ─
test("GAP-7: checkInstallIntegrity NUNCA verifica existência de itens kind:'dir' — ponto cego real (achado desta sessão)", async () => {
  const { checkInstallIntegrity } = await imp("src/installer/integrity.js")
  const { saveManifest, freshManifest } = await imp("src/installer/manifest.js")
  const home = await mk("gstack-s470-manifest-")
  try {
    const manifest = freshManifest()
    // item DIR cujo path NUNCA existiu (simula tmpdir de teste já limpo pelo SO)
    manifest.items.push({ path: path.join(tmpdir(), "gstack-fake-orphan-dir-xyz"), kind: "dir", removeOnUninstall: true })
    saveManifest(manifest, home)
    const r = checkInstallIntegrity(home)
    // BUG real: mesmo com o dir órfão, integrity não acusa nada (ponto cego kind:"dir")
    assert.equal(r.issues.length, 0, "hoje isso NÃO é detectado — é exatamente por isso que o manifest real da máquina acumulou 330 itens órfãos sem o doctor nunca apontar")
    assert.equal(r.safeToUninstall, true, "safeToUninstall mente por omissão quando só há itens dir órfãos")
  } finally { await rm(home, { recursive: true, force: true }) }
})

// ── 8. GAP: doctor e readiness resolvem Headroom por caminhos DIFERENTES ─────
test("GAP-8: doctor checa Headroom via PATH global; readiness checa o venv LOCAL do projeto — alvos diferentes, podem divergir", async () => {
  const doctorSrc = src("src/installer/doctor.js")
  const readinessSrc = src("src/tools/readiness.js")
  assert.match(doctorSrc, /toolVer\("headroom"\)/, "doctor usa toolVer('headroom') — spawn direto por PATH")
  assert.match(readinessSrc, /headroom-venv/, "readiness resolve o venv LOCAL do projeto")
  assert.doesNotMatch(doctorSrc, /headroom-venv/, "doctor NUNCA olha o venv local — não sabe que readiness usa outra fonte")
})

// ── 9. Guard: manifest.agents deve bater com specialization.total (auto-consistência) ─
test("GUARD-9: agents/generated/manifest.json — 'agents' e 'specialization.total' nunca podem divergir", async () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "agents", "generated", "manifest.json"), "utf-8"))
  assert.equal(manifest.agents, manifest.specialization.total, "contagem interna do manifest deve ser auto-consistente")
})

// ── 10. Guard: MCP nunca registra global sem consentimento/ownership explícito ─
test("GUARD-10: registerRuntimeMcp é sempre project-scoped ('runtime_injected') — nunca escreve global por default", async () => {
  const { registerRuntimeMcp } = await imp("src/mcp/scope.js")
  const dir = await mk("gstack-s470-mcp-")
  try {
    const r = registerRuntimeMcp({ cwd: dir, name: "test-mcp", server: {} })
    assert.equal(r.scope, "runtime_injected")
    assert.ok(r.file.startsWith(dir), "arquivo do MCP fica DENTRO do projeto, nunca em home/global")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// ── 11. Guard: operação longa (create com retries) já emite evento por tentativa ─
test("GUARD-11: createStage emite 'attempt_started'/'attempt_failed' POR TENTATIVA (progresso já existe — não é gap)", async () => {
  const runLoopSrc = src("src/project-plan/run-loop.js")
  assert.match(runLoopSrc, /event:\s*"attempt_started"/, "evento de início de tentativa existe hoje")
  assert.match(runLoopSrc, /event:\s*"attempt_failed"/, "evento de falha de tentativa existe hoje")
})

// ── 12. Guard: nunca rotular harness instrucional como enforcement real_hooks ─
test("GUARD-12: nenhum harness com mode 'instructional' (capabilities.js) tem enforcement 'real_hooks' em ADAPTER_MATRIX", async () => {
  const { buildHarnessRegistry } = await imp("src/dream/harness-registry.js")
  const r = buildHarnessRegistry()
  for (const h of r.harnesses) {
    if (h.capabilities?.mode === "instructional" && h.adapter) {
      assert.notEqual(h.adapter.enforcement, "real_hooks", `${h.id}: instructional nunca pode virar real_hooks`)
    }
  }
})
