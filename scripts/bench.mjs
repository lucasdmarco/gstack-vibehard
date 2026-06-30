#!/usr/bin/env node
// Benchmark leve dos caminhos quentes do runtime/agents/vfa (PRD 12 B3 / PR10).
// Detecta REGRESSÃO de performance (não é teste de carga). Sem deps externas.
import { performance } from "node:perf_hooks"
import { hashFiles } from "../src/agents/factory.js"
import { buildReceipt } from "../src/vfa/attestation.js"
import { allocatePort } from "../src/runtime/ports.js"

async function bench(name, iters, fn) {
  // warmup
  for (let i = 0; i < Math.min(iters, 50); i++) await fn(i)
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) await fn(i)
  const ms = performance.now() - t0
  const per = (ms / iters) * 1000 // µs por op
  console.log(`  ${name.padEnd(34)} ${iters.toLocaleString().padStart(8)} ops · ${ms.toFixed(1).padStart(8)} ms · ${per.toFixed(2).padStart(8)} µs/op`)
  return per
}

const files = Array.from({ length: 25 }, (_, i) => ({ rel: `agents/agents/a${i}.md`, content: "x".repeat(800) + i }))

console.log("bench — caminhos quentes (µs/op menor é melhor):")
await bench("hashFiles (25 arquivos de fonte)", 2000, () => hashFiles(files))
await bench("buildReceipt (recibo VFA)", 5000, (i) => buildReceipt({ runId: "r", actionId: "a" + i, input: "in" + i, output: "out" + i, previousHash: "sha256:" + "0".repeat(64) }))
await bench("allocatePort (isFree injetado)", 5000, (i) => allocatePort(5000 + (i % 100), { isFree: async (p) => p % 2 === 0 }))

console.log("ok")
