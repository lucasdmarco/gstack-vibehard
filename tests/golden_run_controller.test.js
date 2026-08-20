import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

async function freshEngine(attempts = 1) {
  const { LoopEngine } = await imp("src/skills/loop-engine.js")
  const engine = new LoopEngine({ runId: "r1", intent: "x" })
  for (const phase of ["plan", "scout", "approve", "implement", "run", "observe", "diagnose", "checkpoint", "verify", "proof"]) {
    engine.advance(phase)
  }
  for (let i = 0; i < attempts; i++) engine.recordAttempt({})
  return engine
}

test("deriveEngineGates: stages ready/not_applicable -> observationFresh/checkpointGreen true", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  const g = deriveEngineGates({ stages: { test: { status: "ready" }, verify: { status: "not_applicable" } } })
  assert.equal(g.observationFresh, true)
  assert.equal(g.checkpointGreen, true)
})

test("deriveEngineGates: stage failed -> gate correspondente false (nunca finge verde)", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  const g = deriveEngineGates({ stages: { test: { status: "failed" }, verify: { status: "ready" } } })
  assert.equal(g.observationFresh, false)
  assert.equal(g.checkpointGreen, true)
})

test("deriveEngineGates: acceptance vazia OU com pending_verifier -> acceptanceResolved false (GAP-3 do S47.0)", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  assert.equal(deriveEngineGates({ acceptance: [] }).acceptanceResolved, false)
  assert.equal(deriveEngineGates({ acceptance: [{ id: "feature-behavior", pending_verifier: { reason: "x" } }] }).acceptanceResolved, false)
})

/**
 * PRD52 S52.J — a assertiva que este teste carregava era o defeito.
 *
 * Ela exigia `acceptanceResolved === true` para um aceite que apenas DECLARAVA um
 * verifier, sem ninguém ter rodado nada. Era a semântica que o §2 do PRD53 nomeia
 * e proíbe, congelada como expectativa — o teste protegia o defeito.
 *
 * Agora o mesmo aceite, sem resultado de execução, NÃO resolve. É o teste que
 * mais mudou de significado no sprint: de "verifier existe, logo passou" para
 * "sem execução não há veredito".
 */
test("verifier DECLARADO e nunca executado NÃO resolve o aceite (o defeito que o §2 nomeia)", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  const soDeclarado = [{ id: "lint", verifier: { kind: "gate", ref: "lint" } }]
  const g = deriveEngineGates({ acceptance: soDeclarado })
  assert.equal(g.acceptanceResolved, false, "declarar não é executar")
  assert.equal(g.compliance.items[0].status, "unverified")
  assert.match(g.compliance.items[0].reason, /sem resultado de teste/)
})

test("com compliance EXECUTADO, o mesmo aceite resolve — o portão continua alcançável", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  const g = deriveEngineGates({
    acceptance: [{ id: "lint", verifier: { kind: "gate", ref: "lint" } }],
    testResults: { lint: true },
  })
  assert.equal(g.acceptanceResolved, true, "execução real abre o portão — endurecer não é fechar")
  assert.equal(g.compliance.items[0].status, "compliant")
})

test("CONTROLE NEGATIVO: verificador que REPROVOU não resolve o aceite", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  const g = deriveEngineGates({
    acceptance: [{ id: "lint", verifier: { kind: "gate", ref: "lint" } }],
    testResults: { lint: false },
  })
  assert.equal(g.acceptanceResolved, false)
  assert.equal(g.compliance.items[0].status, "failed")
})

test("CONTROLE NEGATIVO: journey cujo diff NÃO tocou os arquivos relevantes não resolve", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  const acceptance = [{ id: "login", verifier: { kind: "playwright", ref: "e2e/login.spec.ts", files: ["src/auth.ts"] } }]
  const g = deriveEngineGates({ acceptance, changedFiles: ["README.md"], testResults: { login: true } })
  assert.equal(g.acceptanceResolved, false, "teste verde sobre código não tocado não prova a jornada")
  assert.match(g.compliance.items[0].reason, /diff não tocou/)
})

test("deriveEngineGates: sem proof (null) -> proofReady false; proof.ready:true -> proofReady true", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  assert.equal(deriveEngineGates({ proof: null }).proofReady, false)
  assert.equal(deriveEngineGates({ proof: { ran: true, ready: true } }).proofReady, true)
  assert.equal(deriveEngineGates({ proof: { ran: true, ready: false } }).proofReady, false)
})

/**
 * A PROVA DE QUE `completed` CONTINUA ALCANÇÁVEL (PRD52 S52.J).
 *
 * Endurecer o portão só é legítimo se o caminho honesto seguir aberto. Este
 * teste é o contrato disso: com os quatro portões verdes E o compliance
 * EXECUTADO, o run chega a `completed`. Se algum dia ele ficar vermelho sem que
 * alguém tenha decidido mudar a semântica, o `start` deixou de ser entregável —
 * e isso precisa quebrar aqui, alto, e não em silêncio na mão do usuário.
 */
test("finalizeGoldenRun: com compliance executado, os 4 portões verdes levam a `completed`", async () => {
  const { finalizeGoldenRun } = await imp("src/project-plan/golden-run.js")
  const engine = await freshEngine(1)
  const r = finalizeGoldenRun(engine, {
    stages: { test: { status: "ready" }, verify: { status: "ready" } },
    proof: { ran: true, ready: true },
    acceptance: [{ id: "lint", verifier: { kind: "gate", ref: "lint" } }],
    testResults: { lint: true },
  })
  assert.equal(r.status, "completed", "todos os 4 portões verdes -> completed real, não 'done' frouxo")
  assert.equal(engine.status, "completed", "engine.finalize() mutou o motor de verdade")
})

test("finalizeGoldenRun: os MESMOS portões, sem compliance executado, NÃO completam", async () => {
  const { finalizeGoldenRun } = await imp("src/project-plan/golden-run.js")
  const engine = await freshEngine(1)
  const r = finalizeGoldenRun(engine, {
    stages: { test: { status: "ready" }, verify: { status: "ready" } },
    proof: { ran: true, ready: true },
    acceptance: [{ id: "lint", verifier: { kind: "gate", ref: "lint" } }],
  })
  assert.notEqual(r.status, "completed",
    "a diferença entre este teste e o anterior é UMA execução — e é ela que decide")
})

test("finalizeGoldenRun: SEM acceptance resolvida -> NUNCA completed, mesmo com test/verify/proof verdes (DoD)", async () => {
  const { finalizeGoldenRun } = await imp("src/project-plan/golden-run.js")
  const engine = await freshEngine(1)
  const r = finalizeGoldenRun(engine, {
    stages: { test: { status: "ready" }, verify: { status: "ready" } },
    proof: { ran: true, ready: true },
    acceptance: [], // vazio -> acceptanceResolved false
  })
  assert.notEqual(r.status, "completed")
  assert.equal(r.gates.acceptanceResolved, false)
})

test("finalizeGoldenRun: zero tentativas -> not_executed (nunca completed sem terminal condition)", async () => {
  const { finalizeGoldenRun } = await imp("src/project-plan/golden-run.js")
  const engine = await freshEngine(0)
  const r = finalizeGoldenRun(engine, { stages: {}, proof: null, acceptance: [] })
  assert.equal(r.status, "not_executed")
})

test("finalizeGoldenRun: cancelled:true -> status cancelled, domina qualquer gate", async () => {
  const { finalizeGoldenRun } = await imp("src/project-plan/golden-run.js")
  const engine = await freshEngine(1)
  const r = finalizeGoldenRun(engine, {
    stages: { test: { status: "ready" }, verify: { status: "ready" } },
    proof: { ran: true, ready: true },
    acceptance: [{ id: "lint", verifier: { kind: "gate", ref: "lint" } }],
    cancelled: true,
  })
  assert.equal(r.status, "cancelled")
})

test("resumableFrom: handoff é terminal (não resumível); qualquer outra fase é resumível", async () => {
  const { resumableFrom } = await imp("src/project-plan/golden-run.js")
  assert.equal(resumableFrom("handoff").resumable, false)
  assert.equal(resumableFrom("verify").resumable, true)
  assert.equal(resumableFrom("implement").resumable, true)
})

test("transição inválida no motor real falha fechado (InvalidTransitionError) — DoD: nunca contornável", async () => {
  const { LoopEngine, InvalidTransitionError } = await imp("src/skills/loop-engine.js")
  const engine = new LoopEngine({ runId: "r2" })
  assert.throws(() => engine.advance("proof"), InvalidTransitionError, "intent->proof não é uma aresta permitida")
})
