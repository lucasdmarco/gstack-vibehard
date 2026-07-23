#!/usr/bin/env node
// Benchmark do roteador de media-intake (PRD49 S49.8) — COMPARATIVO sobre
// fixtures determinísticas, nunca cross-harness ao vivo, nunca uma % de
// economia fixa alegada como resultado do GStack.
import { selectMediaBackend, boundedFrameBudget } from "../src/capabilities/media-intake.js"

const FAMILIES = [
  { name: "vídeo curto com captions, sem timestamp", evidence: { captionsAvailable: true, visualTimestampNeeded: false, durationSeconds: 300 }, expectBackend: "transcript" },
  { name: "vídeo longo com captions, timestamp visual necessário", evidence: { captionsAvailable: true, visualTimestampNeeded: true, durationSeconds: 3600 }, expectBackend: "frames" },
  { name: "vídeo sem captions, sem timestamp", evidence: { captionsAvailable: false, visualTimestampNeeded: false, durationSeconds: 600 }, expectBackend: "transcript" },
  { name: "vídeo de 10h com timestamp necessário", evidence: { captionsAvailable: false, visualTimestampNeeded: true, durationSeconds: 36000 }, expectBackend: "frames" },
]

console.log("bench-media-intake — famílias de fixture (nunca % fixa alegada como resultado):")
let mismatches = 0
for (const f of FAMILIES) {
  const r = selectMediaBackend(f.evidence)
  const ok = r.backend === f.expectBackend
  if (!ok) mismatches += 1
  console.log(`  ${ok ? "✓" : "✗"} ${f.name.padEnd(45)} backend=${r.backend} frameBudget=${r.frameBudget}`)
}

console.log("\n  orçamento de frame sempre limitado, independente da duração:")
for (const seconds of [60, 3600, 36000, 360000]) {
  const budget = boundedFrameBudget({ durationSeconds: seconds, cap: 20 })
  console.log(`    ${String(seconds).padStart(7)}s -> ${budget} frame(s) (cap=20)`)
  if (budget > 20) mismatches += 1
}

if (mismatches > 0) {
  console.error(`\n${mismatches} família(s) não bateram com o esperado — regressão real no roteador.`)
  process.exitCode = 1
} else {
  console.log("\nok — nenhuma % de economia/qualidade cross-harness é alegada por este script.")
}
