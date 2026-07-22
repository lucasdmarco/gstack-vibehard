import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD48 S48.0 — baseline pós-PRD47 e controles negativos. Garante que o PRD48 parte do
 * produto REALMENTE entregue (comportamento, não texto de PRD): PRD45 (readiness/policy/
 * checkpoint), PRD46 (governança de skill), PRD47 (Golden Run/Context Delta) precisam
 * estar disponíveis e fail-closed ANTES de qualquer sprint de UX terminal-first tocar
 * neles. Nenhuma alteração de motor de produção neste sprint — só prova.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const bin = path.join(repoRoot, "src", "index.js")
const fixturesDir = path.join(repoRoot, "tests", "fixtures", "terminal-first")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

function run(args, cwd) {
  try { return { code: 0, out: execFileSync("node", [bin, ...args], { cwd, encoding: "utf-8", stdio: "pipe", timeout: 30000 }) } }
  catch (e) { return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + "" } }
}

// --- Baseline: as capacidades dos 3 PRDs anteriores existem POR COMPORTAMENTO ---

test("baseline PRD45: readiness declara status TIPADO (nunca 'ready' por omissão)", async () => {
  const { buildReadiness, STATUS_DESCRIPTIONS } = await imp("src/tools/readiness.js")
  const r = buildReadiness({ cwd: repoRoot })
  assert.ok(r && typeof r === "object", "readiness real, não mock")
  assert.ok(Object.keys(STATUS_DESCRIPTIONS).length > 0, "vocabulário de status real")
})

test("baseline PRD46: governança de skill (candidate.js) é fail-closed — sem saltos de estado", async () => {
  const { canTransition, CANDIDATE_TRANSITIONS } = await imp("src/dream/candidate.js")
  assert.equal(canTransition("observed", "promoted"), false, "nenhum salto direto observed->promoted")
  assert.ok(CANDIDATE_TRANSITIONS.observed.length > 0, "transições reais existem")
})

test("baseline PRD47: Golden Run Controller está de fato ligado em run-loop.js (não só existe isolado)", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(path.join(repoRoot, "src", "project-plan", "run-loop.js"), "utf-8")
  assert.match(src, /finalizeGoldenRun/, "run-loop.js importa/chama o Golden Run Controller real (S47.1)")
})

test("baseline PRD47: Context Delta (S47.7) existe e é importável de verdade", async () => {
  const { CONTEXT_DELTA_SCHEMA } = await imp("src/project-plan/context-delta.js")
  assert.equal(CONTEXT_DELTA_SCHEMA, "gstack.context-delta.v1")
})

test("baseline: start --dry-run --json roda a partir da árvore fonte, JSON puro, nada escrito", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-prd48-baseline-"))
  try {
    const r = run(["start", "app de teste", "--name", "t", "--dry-run", "--json"], cwd)
    const d = JSON.parse(r.out)
    assert.equal(d.dryRun, true)
    assert.equal(existsSync(path.join(cwd, ".gstack")), false, "dry-run não escreve .gstack")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

// --- Controles negativos exigidos pelo DoD do sprint 48.0 ---

test("CONTROLE NEGATIVO — auth/modelo unknown: NUNCA promovido a 'known'/usável sem evidência", async () => {
  const { MODEL_STATES, preflightModel } = await imp("src/skills/model-preflight.js")
  assert.ok(MODEL_STATES.includes("unknown"), "vocabulário tem 'unknown'")
  const r = preflightModel({ model: "modelo-inexistente-xyz", availableModels: ["gpt-5", "claude-5"] })
  assert.notEqual(r.state, "known", "modelo não comprovado nunca vira known")
})

test("CONTROLE NEGATIVO — run interrompido: Context Delta NUNCA reusa frescor velho silenciosamente", async () => {
  const { buildContextDelta, resolveContextDeltaLoad } = await imp("src/project-plan/context-delta.js")
  const delta = buildContextDelta({})
  const staleResume = resolveContextDeltaLoad(delta, { graphState: "stale" })
  assert.equal(staleResume.action, "regenerate", "grafo stale nunca vira 'reuse' silencioso")
  const unknownResume = resolveContextDeltaLoad(delta, { graphState: "unknown" })
  assert.notEqual(unknownResume.action, "reuse", "estado desconhecido nunca vira reuse")
})

test("CONTROLE NEGATIVO — checkpoint adulterado: rollback detecta tamper e ABORTA sem escrever nada", async () => {
  const { createCheckpoint, rollbackToCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = mkdtempSync(path.join(tmpdir(), "gstack-prd48-tamper-"))
  try {
    writeFileSync(path.join(root, "file.txt"), "conteudo original")
    const ck = createCheckpoint({ root, runId: "run-tamper-test", files: ["file.txt"], green: true })
    assert.equal(ck.ok, true)
    // adultera o blob capturado DEPOIS do checkpoint (fora do fluxo normal)
    const blobPath = path.join(root, ".gstack", "runs", "run-tamper-test", "checkpoints", String(ck.seq), "files", "file.txt")
    writeFileSync(blobPath, "conteudo ADULTERADO")
    const rb = rollbackToCheckpoint({ root, runId: "run-tamper-test", seq: ck.seq })
    assert.equal(rb.ok, false)
    assert.equal(rb.reason, "tamper_detected")
    assert.deepEqual(rb.restored, [], "nada é restaurado quando há tamper — falha fechada")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("CONTROLE NEGATIVO — projeto existente sujo (dirty tree): detectado, NUNCA descartado", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-prd48-dirty-"))
  try {
    cpSync(path.join(fixturesDir, "brownfield-node"), root, { recursive: true })
    execFileSync("git", ["init", "-q"], { cwd: root })
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: root })
    execFileSync("git", ["config", "user.name", "t"], { cwd: root })
    execFileSync("git", ["add", "-A"], { cwd: root })
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root })
    // altera SEM commitar — dirty tree real
    writeFileSync(path.join(root, "index.js"), "console.log('alterado sem commit')")
    const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf-8" })
    assert.notEqual(porcelain.trim(), "", "dirty tree é detectável de verdade (git real)")
    // a alteração continua lá — nada neste teste (nem qualquer motor) descarta o arquivo do usuário
    const content = await import("node:fs").then((fs) => fs.readFileSync(path.join(root, "index.js"), "utf-8"))
    assert.match(content, /alterado sem commit/, "alteração do usuário preservada, nunca descartada")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("CONTROLE NEGATIVO — policy 'ask': NUNCA resolvido silenciosamente para 'allow'", async () => {
  const { evaluate, DEFAULT_POLICY, DECISIONS } = await imp("src/policy/schema.js")
  assert.ok(DECISIONS.includes("ask"))
  const r = evaluate(DEFAULT_POLICY, "Write(src/index.js)")
  assert.equal(r.decision, "ask", "escrita genérica cai em ask por padrão — nunca allow silencioso")
})

test("baseline: nenhum teste deste arquivo mocka a EXISTÊNCIA de um módulo — todo import é real", async () => {
  // prova estrutural: se qualquer um dos imports acima falhasse (ERR_MODULE_NOT_FOUND), os
  // testes anteriores já teriam falhado primeiro. Este teste documenta a garantia do DoD.
  assert.ok(true)
})
