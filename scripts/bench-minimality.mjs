#!/usr/bin/env node
// Benchmark do gate de minimalidade (PRD49 S49.5) — COMPARATIVO sobre fixtures
// determinísticas de decision-evidence, nunca uma % fixa alegada como resultado
// do GStack e nunca um benchmark cross-harness ao vivo (não existe wiring real
// de decision-evidence hoje — ver nota em src/skills/gate-matrix.js
// minimality-gate). Serve só para detectar regressão de performance/lógica do
// avaliador puro, não para medir Claude/Codex/OpenCode reais.
import { evaluateMinimality } from "../src/skills/minimality.js"

// Famílias de fixture — cada uma representa um padrão de decisão plausível,
// não uma medição de tarefa real de um harness.
const FAMILIES = [
  { name: "sem introdução", decision: { introducesNewDependency: false, introducesNewAbstraction: false }, expect: "pass" },
  { name: "dependência nova sem motivo", decision: { introducesNewDependency: true, newDependencyReason: null, protectedConcerns: [] }, expect: "blocked" },
  { name: "dependência nova com motivo", decision: { introducesNewDependency: true, newDependencyReason: "sem equivalente stdlib", protectedConcerns: [] }, expect: "pass" },
  { name: "concern protegido (security)", decision: { introducesNewDependency: true, newDependencyReason: null, protectedConcerns: ["security"] }, expect: "exempt" },
  { name: "abstração redundante (reuse disponível)", decision: { introducesNewAbstraction: true, existingReuse: true, smallestCompleteApproach: false, protectedConcerns: [] }, expect: "blocked" },
  { name: "abstração sem reuse disponível", decision: { introducesNewAbstraction: true, existingReuse: false, smallestCompleteApproach: true, protectedConcerns: [] }, expect: "pass" },
]

console.log("bench-minimality — famílias de fixture (decision-evidence, não benchmark cross-harness ao vivo):")
let mismatches = 0
for (const f of FAMILIES) {
  const r = evaluateMinimality(f.decision)
  const ok = r.verdict === f.expect
  if (!ok) mismatches += 1
  console.log(`  ${ok ? "✓" : "✗"} ${f.name.padEnd(38)} verdict=${r.verdict}${r.reason ? ` (${r.reason})` : ""}`)
}

const t0 = performance.now()
const iters = 20000
for (let i = 0; i < iters; i++) evaluateMinimality(FAMILIES[i % FAMILIES.length].decision)
const ms = performance.now() - t0
console.log(`\n  evaluateMinimality: ${iters.toLocaleString()} ops · ${ms.toFixed(1)} ms · ${((ms / iters) * 1000).toFixed(2)} µs/op`)

if (mismatches > 0) {
  console.error(`\n${mismatches} família(s) não bateram com o esperado — regressão real no avaliador.`)
  process.exitCode = 1
} else {
  console.log("\nok — nenhuma % de economia/qualidade cross-harness é alegada por este script.")
}
