/**
 * Schema simples de grafo determinístico para workflows agênticos.
 *
 * Filosofia: o LLM decide DENTRO do nó (raciocínio); o CÓDIGO decide as ARESTAS
 * (fluxo). Nós: computacao, raciocinio (worker), verificador. Arestas: condições
 * determinísticas (tests_passed, qg_failed, max_iterations_hit).
 */

export const NODE_TYPES = ["planner", "rubric", "worker", "verifier", "retry", "human_handoff", "done"]

/** Cria um nó válido. */
export function makeNode(id, type, opts = {}) {
  return { id, type, ...opts }
}

/** Cria uma aresta com condição determinística (string). */
export function makeEdge(from, to, condition) {
  return { from, to, condition }
}

/** Estado inicial de um run. */
export function makeState(task, opts = {}) {
  return {
    task,
    iteration: 0,
    consecutiveSameFailure: 0,
    lastFailureSignature: null,
    completedNodes: [],
    status: "running", // running | passed | failed | handoff
    ...opts,
  }
}

/** Rubrica: critérios determinísticos que o verifier avalia. */
export function makeRubric(criteria = []) {
  // criteria: [{ id, check: "tests_passed"|"qg_passed"|..., required:true }]
  return { criteria }
}

export function validateNode(node) {
  const errors = []
  if (!node || typeof node !== "object") return { valid: false, errors: ["no ausente"] }
  if (!node.id) errors.push("id obrigatorio")
  if (!NODE_TYPES.includes(node.type)) errors.push(`type invalido: ${node.type}`)
  return { valid: errors.length === 0, errors }
}

export function validateGraph(graph) {
  const errors = []
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { valid: false, errors: ["graph precisa de nodes[] e edges[]"] }
  }
  const ids = new Set(graph.nodes.map((n) => n.id))
  for (const n of graph.nodes) {
    const r = validateNode(n)
    if (!r.valid) errors.push(...r.errors)
  }
  for (const e of graph.edges) {
    if (!ids.has(e.from)) errors.push(`edge.from desconhecido: ${e.from}`)
    if (!ids.has(e.to)) errors.push(`edge.to desconhecido: ${e.to}`)
  }
  return { valid: errors.length === 0, errors }
}
