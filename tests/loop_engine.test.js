import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src/skills/loop-engine.js"))}?t=${Date.now()}`)

// Relógio de teste controlável (o motor NUNCA aceita tempo de fora — só o relógio).
function fakeClock(start = 0) {
  let t = start
  const fn = () => t
  fn.advance = (ms) => { t += ms }
  return fn
}

test("advance segue o pipeline; pular fase lança invalid_transition (P0.5)", async () => {
  const { LoopEngine } = await imp()
  const e = new LoopEngine({ runId: "r1", intent: "criar feature" })
  assert.equal(e.phase, "intent")
  e.advance("plan"); e.advance("scout"); e.advance("approve"); e.advance("implement")
  assert.equal(e.phase, "implement")
  // pular direto pra checkpoint é proibido
  assert.throws(() => e.advance("checkpoint"), (err) => {
    assert.equal(err.code, "invalid_transition")
    assert.equal(err.from, "implement"); assert.equal(err.to, "checkpoint")
    return true
  })
})

test("`economy`/`diagnose` fora de hora → invalid_transition (não acontece)", async () => {
  const { LoopEngine } = await imp()
  const e = new LoopEngine({ intent: "x" })
  // logo no intent, chamar diagnose é inválido
  assert.throws(() => e.advance("diagnose"), /invalid_transition/)
  // economy nem é fase do pipeline
  assert.throws(() => e.advance("economy"), /invalid_transition/)
})

test("PROPERTY: nenhuma sequência aleatória de advance pula uma transição não-declarada", async () => {
  const { LoopEngine, ALLOWED_TRANSITIONS, ENGINE_PHASES } = await imp()
  let rng = 123456789
  const rand = (n) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n }
  for (let trial = 0; trial < 300; trial++) {
    const e = new LoopEngine({ intent: "t" })
    for (let step = 0; step < 20; step++) {
      const to = ENGINE_PHASES[rand(ENGINE_PHASES.length)]
      const legal = (ALLOWED_TRANSITIONS[e.phase] || []).includes(to)
      if (legal) {
        const before = e.phase
        e.advance(to)
        assert.equal(e.phase, to, `avançou de ${before} para ${to}`)
      } else {
        const stuck = e.phase
        assert.throws(() => e.advance(to), /invalid_transition/)
        assert.equal(e.phase, stuck, "transição inválida NÃO muda a fase")
      }
    }
  }
})

test("caps são do MOTOR: contador de tentativas estoura → hard halt (P0.6)", async () => {
  const { LoopEngine } = await imp()
  const e = new LoopEngine({ intent: "x", budget: { maxIterations: 3 } })
  assert.equal(e.recordAttempt({ tokens: 10 }).halted, false)
  assert.equal(e.recordAttempt({ tokens: 10 }).halted, false)
  const third = e.recordAttempt({ tokens: 10 })
  assert.equal(third.halted, true)
  assert.match(third.reason, /3 tentativas/)
  assert.equal(e.status, "blocked")
  assert.equal(e.counters().tokens, 30, "tokens são MEDIDOS e somados pelo motor")
})

test("caps: wall-clock pelo relógio do motor (tempo não vem de fora)", async () => {
  const { LoopEngine } = await imp()
  const clock = fakeClock(1000)
  const e = new LoopEngine({ intent: "x", budget: { maxIterations: 99, maxWallTimeSeconds: 5 }, clock })
  e.recordAttempt({})
  assert.equal(e.capStatus().halted, false)
  clock.advance(6000) // passa dos 5s
  const s = e.capStatus()
  assert.equal(s.halted, true)
  assert.match(s.reason, /tempo/)
})

test("caps: thrashing (mesma falha 3× seguidas) → halt", async () => {
  const { LoopEngine } = await imp()
  const e = new LoopEngine({ intent: "x", budget: { maxIterations: 99 } })
  e.recordAttempt({ errorHash: "ERR_A" })
  e.recordAttempt({ errorHash: "ERR_A" })
  const s = e.recordAttempt({ errorHash: "ERR_A" })
  assert.equal(s.halted, true)
  assert.match(s.reason, /thrashing/)
})

test("thrashing NÃO dispara quando as falhas são distintas", async () => {
  const { LoopEngine } = await imp()
  const e = new LoopEngine({ intent: "x", budget: { maxIterations: 99 } })
  const s1 = e.recordAttempt({ errorHash: "A" })
  const s2 = e.recordAttempt({ errorHash: "B" })
  const s3 = e.recordAttempt({ errorHash: "C" })
  assert.equal(s1.halted || s2.halted || s3.halted, false)
  assert.equal(e.counters().consecutiveIdenticalFailures, 1)
})

test("phaseAtLeast: ordem canônica do pipeline (fonte única de ranking)", async () => {
  const { phaseAtLeast, phaseRank } = await imp()
  assert.equal(phaseAtLeast("checkpoint", "diagnose").ok, true, "checkpoint >= diagnose")
  assert.equal(phaseAtLeast("implement", "diagnose").ok, false, "implement < diagnose")
  assert.match(phaseAtLeast("implement", "diagnose").reason, /invalid_transition/)
  assert.equal(phaseAtLeast("run", "xyz").ok, false, "fase mínima desconhecida")
  assert.ok(phaseRank("proof") > phaseRank("implement"))
})

test("finalize: só `completed` com TODOS os portões; senão status honesto (P1.5)", async () => {
  const { LoopEngine } = await imp()
  // nada executado → not_executed
  const a = new LoopEngine({ intent: "x" })
  assert.equal(a.finalize({}).status, "not_executed")

  // executou mas sem prova → NÃO é completed
  const b = new LoopEngine({ intent: "x" })
  b.recordAttempt({})
  const rb = b.finalize({ acceptanceResolved: true, observationFresh: true, checkpointGreen: false, proofReady: false })
  assert.notEqual(rb.status, "completed")

  // todos os portões verdes → completed
  const c = new LoopEngine({ intent: "x" })
  c.recordAttempt({})
  const rc = c.finalize({ acceptanceResolved: true, observationFresh: true, checkpointGreen: true, proofReady: true })
  assert.equal(rc.status, "completed")

  // cancelado explícito
  const d = new LoopEngine({ intent: "x" })
  assert.equal(d.finalize({ cancelled: true }).status, "cancelled")

  // estourou cap antes → blocked (não vira completed nem com portões)
  const e = new LoopEngine({ intent: "x", budget: { maxIterations: 1 } })
  e.recordAttempt({})
  const re = e.finalize({ acceptanceResolved: true, observationFresh: true, checkpointGreen: true, proofReady: true })
  assert.equal(re.status, "blocked")
})
