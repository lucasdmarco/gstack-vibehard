#!/usr/bin/env node
// Benchmark do protocolo epistêmico (PRD50 S50.6).
//
// Mede SÓ o que tem gabarito objetivo. A fatia subjetiva sai listada como
// pendente de rótulo humano cego — auto-rotular seria circular (§2.3 item 1).
// Nenhum percentual de Aletheia/Deep Think é transferido para cá (§17.2).
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  measureFalseSupported, measureCitationPrecision, measureNoFalseCitationSupport,
  measureClassificationAccuracy, measureAbstention, measureToolClaimsWithoutReceipt,
  measureProvedFromLlm, pendingHumanLabeling, buildBenchmarkReport,
} from "../src/epistemic/benchmark.js"

const root = path.resolve(import.meta.dirname, "..")
const fixture = (n) => JSON.parse(readFileSync(path.join(root, "tests", "fixtures", "epistemic", n), "utf-8"))

const { cases } = fixture("corpus.json")
const { pairs } = fixture("citation-pairs.json")

const judge = (c) => ({ true: "supported", false: "refuted", insufficient: "inconclusive", ambiguous: "inconclusive" }[c.groundTruth])

const results = {
  falseSupported: measureFalseSupported(cases, judge),
  citation: measureCitationPrecision(pairs),
  citationLeak: measureNoFalseCitationSupport(pairs),
  classification: measureClassificationAccuracy(cases),
  abstention: measureAbstention(cases, judge),
  toolReceipts: measureToolClaimsWithoutReceipt([]),
  provedFromLlm: measureProvedFromLlm([]),
}
const report = buildBenchmarkReport(results)
const human = pendingHumanLabeling(cases)

const pctStr = (v) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`)

console.log("bench-epistemic — gates objetivos (PRD50 S50.6)\n")
console.log(`  falso-suporte              ${results.falseSupported.falseSupported}/${results.falseSupported.total} (${pctStr(results.falseSupported.rate)})`)
console.log(`  precisão de citação        ${results.citation.correct}/${results.citation.total} (${pctStr(results.citation.precision)})`)
console.log(`  citação vazando p/ suporte ${results.citationLeak.leaked} (gate: 0)`)
console.log(`  classificação determinística ${results.classification.correct}/${results.classification.total} (${pctStr(results.classification.accuracy)})`)
console.log(`  abstenção (recall)         ${results.abstention.abstained}/${results.abstention.total} (${pctStr(results.abstention.recall)})`)

console.log("\n  gates:")
for (const g of report.gates) console.log(`    ${g.passed ? "✓" : "✗"} ${g.id}`)

console.log(`\n  gates objetivos: ${report.objectiveGatesReady ? "PASSAM" : "REPROVAM"}`)
console.log(`  validação completa: ${report.fullyValidated} (por design — falta a fatia humana)`)

console.log(`\n  PENDENTE DE RÓTULO HUMANO CEGO (${human.count} caso(s)): ${human.ids.join(", ")}`)
console.log(`    métricas: ${human.metrics.join(", ")}`)
console.log(`    motivo: ${human.reason}`)
console.log("    como rotular: docs/guides/epistemic-benchmark.md")

if (!report.objectiveGatesReady) process.exitCode = 1
