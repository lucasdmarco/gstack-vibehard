/**
 * PRD47 S47.1 — Golden Run Controller: agregador FINO sobre o Loop Engine já
 * canônico (`src/skills/loop-engine.js`, PRD41 S41.4) e o pipeline real
 * (`run-loop.js`). NÃO duplica `replit-loop.js`, journal, state store ou
 * closeout — só traduz os stages já computados pelo pipeline em portões que o
 * motor entende, e devolve o veredito TIPADO do motor (`completed|handoff|
 * blocked|planned_only|not_executed|cancelled`) como fonte única de verdade.
 *
 * Reconciliação (achado da auditoria pré-execução): `finishPipeline` sempre
 * derivou `status` sozinho, por `GATE_STAGES` (test/verify) — o motor tinha os
 * 4 portões mais estritos (`allGatesGreen`) mas `finalize()` NUNCA era chamado.
 * Este módulo liga o motor de verdade, expondo o veredito estrito como
 * `goldenRun` ao lado do `status` solto existente — sem substituí-lo ainda
 * (substituir hoje quebraria pipelines reais: `acceptanceResolved`/`proofReady`
 * exigem features que só chegam em sprints seguintes — 47.2 acceptance real,
 * proof sempre rodar). Sem terminal condition real → NUNCA `completed` falso.
 */
import { LoopEngine } from "../skills/loop-engine.js"

const READY_LIKE = new Set(["ready", "not_applicable"])
const isReadyLike = (stage) => READY_LIKE.has(stage?.status)

/** Traduz os stages REAIS do pipeline nos 4 portões que o motor exige p/ `completed`. */
export function deriveEngineGates({ stages = {}, proof = null, acceptance = [] } = {}) {
  const acceptanceResolved = acceptance.length > 0 && acceptance.every((a) => Boolean(a.verifier) && !a.pending_verifier)
  return {
    acceptanceResolved,
    observationFresh: isReadyLike(stages.test),
    checkpointGreen: isReadyLike(stages.verify),
    proofReady: proof ? proof.ready === true : false,
  }
}

/**
 * Chama `engine.finalize()` de verdade (deixa de ser dead code) com os gates
 * traduzidos. Retorna o veredito tipado do motor — NUNCA um "done" frouxo.
 */
export function finalizeGoldenRun(engine, { stages, proof, acceptance, cancelled = false } = {}) {
  const gates = { ...deriveEngineGates({ stages, proof, acceptance }), cancelled }
  return { ...engine.finalize(gates), gates }
}

/** Resume: a fase persistida do motor é a única fonte de "onde parei" — nunca
 * reinventa a máquina de estados. `handoff` é terminal (precisa de decisão humana). */
export function resumableFrom(enginePhase) {
  return { phase: enginePhase, resumable: enginePhase !== "handoff" }
}
