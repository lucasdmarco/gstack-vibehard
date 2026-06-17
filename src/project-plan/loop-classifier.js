/**
 * Classificador determinístico de loop (PRD kilo-loop-patterns §7). Sem LLM.
 * Entrada: { task, hasFailingTest?, hasRuntimeError?, filesHint? }
 * Saída:   { loopPattern, confidence, reason }
 *
 * Empate → ordem de LOOP_PATTERNS (estável). Sem sinais → test-driven (mais seguro:
 * escreve teste, faz a menor mudança, verifica).
 */
import { LOOP_PATTERNS } from "./loop-patterns.js"

const DEFAULT_LOOP = "test-driven"

function normalize(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}

export function classifyLoop(input = {}) {
  const hay = normalize(input.task)
  let best = { loopPattern: null, matched: [], score: 0 }

  for (const p of Object.values(LOOP_PATTERNS)) {
    const matched = p.intentKeywords.filter((kw) => hay.includes(normalize(kw)))
    if (matched.length > best.score) best = { loopPattern: p.id, matched, score: matched.length }
  }

  // Sinais explícitos reforçam/decidem.
  if (input.hasRuntimeError) {
    if (best.loopPattern !== "runtime-debugging") {
      return { loopPattern: "runtime-debugging", confidence: 0.85, reason: "sinal hasRuntimeError=true indica bug de runtime reproduzível" }
    }
  }
  if (input.hasFailingTest && best.loopPattern !== "test-driven") {
    // só promove se não houver um match mais forte de outro padrão
    if (best.score <= 1) {
      return { loopPattern: "test-driven", confidence: 0.8, reason: "sinal hasFailingTest=true favorece o ciclo guiado por teste" }
    }
  }

  if (!best.loopPattern) {
    return { loopPattern: DEFAULT_LOOP, confidence: 0.3, reason: "sem sinais claros — padrão test-driven (mais seguro)" }
  }

  const confidence = Math.min(0.5 + 0.15 * best.score, 0.95)
  return {
    loopPattern: best.loopPattern,
    confidence: Number(confidence.toFixed(2)),
    reason: `keywords casadas: ${best.matched.join(", ")}`,
  }
}
