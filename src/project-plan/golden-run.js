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
import { complianceReport } from "./acceptance-verification.js"

const READY_LIKE = new Set(["ready", "not_applicable"])
const isReadyLike = (stage) => READY_LIKE.has(stage?.status)

/**
 * Traduz os stages REAIS do pipeline nos 4 portões que o motor exige p/
 * `completed`.
 *
 * PRD52 S52.J — `acceptanceResolved` passou a vir de COMPLIANCE EXECUTADO.
 *
 * Até aqui a derivação era `acceptance.every((a) => Boolean(a.verifier))`: a
 * mera existência do verifier. Bastava o brief declarar "este aceite tem um
 * verificador" para o portão abrir, sem que ninguém tivesse rodado coisa
 * alguma. O §2 do PRD53 nomeia exatamente esse defeito, e o portão de entrada
 * do PRD53 o pegou executando o controle: verifier declarado, zero compliance,
 * `acceptanceResolved: true`.
 *
 * Agora quem decide é `complianceReport`, que já existia desde o PRD47 S47.5 e
 * nunca teve consumidor: um aceite só é `compliant` com verifier real, diff
 * tocando os arquivos relevantes E resultado de teste correspondente. O
 * `testResults` vem de `acceptance-runner.js`, que EXECUTA.
 *
 * O portão ficou mais difícil de abrir, e é o desenho: ele só abre com execução
 * por trás. Um `completed` que dependia de declaração era um verde emprestado.
 */
export function deriveEngineGates({ stages = {}, proof = null, acceptance = [], changedFiles = [], testResults = null } = {}) {
  const compliance = complianceReport({ acceptances: acceptance, changedFiles, testResults })
  return {
    acceptanceResolved: compliance.allCompliant,
    compliance,
    observationFresh: isReadyLike(stages.test),
    checkpointGreen: isReadyLike(stages.verify),
    proofReady: proof ? proof.ready === true : false,
  }
}

/**
 * Chama `engine.finalize()` de verdade (deixa de ser dead code) com os gates
 * traduzidos. Retorna o veredito tipado do motor — NUNCA um "done" frouxo.
 */
export function finalizeGoldenRun(engine, { stages, proof, acceptance, changedFiles, testResults, cancelled = false } = {}) {
  const gates = { ...deriveEngineGates({ stages, proof, acceptance, changedFiles, testResults }), cancelled }
  return { ...engine.finalize(gates), gates }
}

/** Resume: a fase persistida do motor é a única fonte de "onde parei" — nunca
 * reinventa a máquina de estados. `handoff` é terminal (precisa de decisão humana). */
export function resumableFrom(enginePhase) {
  return { phase: enginePhase, resumable: enginePhase !== "handoff" }
}
