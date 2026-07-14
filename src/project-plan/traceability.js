/**
 * Traceability determinística (PRD42 S42.5). Liga a cadeia de produção do valor:
 *   brief → spec → task → diff → test → evidence
 * Cada nó referencia o id do nó ANTERIOR (`ref`). A validação é PURA e determinística (sem LLM):
 * um estágio ausente OU um `ref` que não bate com o id anterior QUEBRA a rastreabilidade. Isso
 * impede "evidência órfã" — uma prova que não se conecta ao brief que a originou.
 */
export const TRACE_SCHEMA = "gstack.traceability.v1"
export const TRACE_STAGES = Object.freeze(["brief", "spec", "task", "diff", "test", "evidence"])

const byStage = (chain) => Object.fromEntries(chain.map((n) => [n.stage, n]))

/** Aponta cada quebra de referência (ref != id do estágio anterior). */
function chainBreaks(nodes) {
  const breaks = []
  for (let i = 1; i < TRACE_STAGES.length; i += 1) {
    const cur = nodes[TRACE_STAGES[i]]
    const prev = nodes[TRACE_STAGES[i - 1]]
    if (cur && prev && cur.ref !== prev.id) breaks.push({ stage: cur.stage, expected: prev.id, got: cur.ref || null })
  }
  return breaks
}

/**
 * Valida a cadeia. `chain`: [{ stage, id, ref }] em qualquer ordem. Retorna { ok, missing, breaks }.
 * ok só quando todos os 6 estágios existem E cada ref bate com o id anterior.
 */
export function validateChain(chain = []) {
  const nodes = byStage(chain)
  const missing = TRACE_STAGES.filter((s) => !nodes[s])
  const breaks = chainBreaks(nodes)
  return { schema: TRACE_SCHEMA, ok: missing.length === 0 && breaks.length === 0, missing, breaks }
}

/** Constrói uma cadeia encadeando ids na ordem canônica (helper para produtores). */
export function linkChain(idsByStage = {}) {
  let prevId = null
  const chain = TRACE_STAGES.filter((s) => idsByStage[s]).map((stage) => {
    const node = { stage, id: idsByStage[stage], ref: prevId }
    prevId = idsByStage[stage]
    return node
  })
  return chain
}
