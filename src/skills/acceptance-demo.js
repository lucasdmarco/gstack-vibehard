import { scorecardFromProof } from "./delivery-scorecard.js"

/**
 * Acceptance Demo (PRD42 S42.12) — `proof --explain`.
 *
 * Duas visões da MESMA evidência: uma LEIGA (para o fundador/usuário final) e uma TÉCNICA
 * (para quem audita os gates). Invariante de honestidade: as duas visões NUNCA divergem no
 * veredito — `lay.ready === technical.ready === proof.ready`. A visão leiga jamais diz
 * "pronto" enquanto a técnica lista bloqueios. Não há segunda fonte de verdade: tudo deriva
 * do `proof` já calculado + o scorecard sobre a mesma evidência.
 *
 * PURO / injetável.
 */
export const ACCEPTANCE_DEMO_SCHEMA = "gstack.acceptance-demo.v1"

const layVerdict = (ready) => (ready ? "PRONTO para entregar" : "AINDA NÃO — há bloqueios a resolver")

const worksAndGaps = (scorecard) => {
  const works = scorecard.items.filter((i) => i.status === "passed").map((i) => i.label)
  const gaps = scorecard.items.filter((i) => i.status === "failed").map((i) => i.label)
  const notEvaluated = scorecard.items.filter((i) => i.status === "not_applicable").map((i) => ({ item: i.label, motivo: i.reason }))
  return { works, gaps, notEvaluated }
}

function buildLay(proof, scorecard) {
  const wg = worksAndGaps(scorecard)
  return {
    veredito: layVerdict(proof.ready),
    ready: proof.ready,
    placar: `${scorecard.score.passed}/${scorecard.score.total} verdes (${scorecard.score.pct}%)`,
    oQueFunciona: wg.works,
    oQueFalta: proof.ready ? [] : proof.blockers.slice(),
    naoAvaliado: wg.notEvaluated,
  }
}

function buildTechnical(proof, scorecard) {
  return {
    ready: proof.ready,
    verdict: scorecard.verdict,
    score: scorecard.score,
    p0Failures: scorecard.p0Failures,
    blockers: proof.blockers.slice(),
    warnings: (proof.warnings || []).slice(),
    gateRegistry: proof.gateRegistry,
    checks: scorecard.items.map((i) => ({ id: i.id, status: i.status, p0: i.p0 })),
  }
}

/** Explica um `proof` em visão leiga + técnica da MESMA evidência. `deploy` alimenta o health. */
export function explainProof(proof = {}, { deploy = {} } = {}) {
  const scorecard = scorecardFromProof(proof, deploy)
  const lay = buildLay(proof, scorecard)
  const technical = buildTechnical(proof, scorecard)
  // Invariante fail-closed: a visão leiga NUNCA pode afirmar "pronto" com a técnica bloqueada.
  if (lay.ready !== technical.ready) throw new Error("acceptance-demo: divergência de veredito entre visões (bug)")
  return { schema: ACCEPTANCE_DEMO_SCHEMA, evidenceOf: proof.schemaVersion, ready: proof.ready, scorecard, lay, technical }
}
