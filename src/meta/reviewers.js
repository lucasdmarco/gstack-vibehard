import { execFileSync } from "child_process"

/**
 * Reviewers LLM PLUGÁVEIS do orchestrate v2 (PRD14 §6.5). SEMPRE advisory:
 * o veredito NUNCA aprova sozinho — `decideStatus` exige o gate determinístico.
 * Honestidade de cobertura: reviewer indisponível/quebrado vira
 * `mode: "deterministic_only"` declarado no resultado — nunca OK falso.
 */

// Registry: id → como invocar o binário do harness com um prompt one-shot.
const REVIEWER_BINS = {
  opencode: { file: "opencode", args: (prompt) => ["run", prompt] },
  claude: { file: "claude", args: (prompt) => ["-p", prompt] },
}

export function knownReviewers() {
  return Object.keys(REVIEWER_BINS)
}

function binAvailable(file, exec) {
  try {
    exec(file, ["--version"], { stdio: "pipe", shell: false, timeout: 5000 })
    return true
  } catch { return false }
}

/** Prompt one-shot de revisão: pede um veredito PARSEÁVEL na primeira linha. */
export function buildReviewPrompt(step = {}, execResult = {}) {
  const diff = String(execResult.diff || "").slice(0, 4000)
  return [
    "Você é um code reviewer ADVISORY (sua opinião não aprova nada sozinha).",
    'Responda na PRIMEIRA linha apenas "VERDICT: OK" ou "VERDICT: RISK", depois 1-3 bullets.',
    `Passo: ${step.id || "?"} (${step.specialty || "implementation"})`,
    "Diff:",
    diff || "(sem diff capturado)",
  ].join("\n")
}

/** Extrai o veredito. Ilegível = SEM SINAL (gate decide) — nunca inventa risco/ok. */
export function parseVerdict(text) {
  const t = String(text || "")
  if (/VERDICT:\s*RISK/i.test(t)) return { ok: false, flagged: true, advisory: true }
  if (/VERDICT:\s*OK/i.test(t)) return { ok: true, advisory: true }
  return { ok: true, advisory: true, note: "veredito ilegível — sem sinal (gate determinístico decide)" }
}

function unavailable(id, note) {
  return { id, available: false, mode: "deterministic_only", note }
}

/**
 * Constrói o reviewer plugável. → { id, available, mode, note?, review? }.
 * `review(step, execResult)` é advisory e FAIL-SOFT: erro do binário vira
 * "sem sinal + cobertura reduzida", nunca aprovação nem crash do run.
 */
export function buildReviewer(id, opts = {}) {
  const exec = opts.exec || execFileSync
  if (!id) return unavailable("none", "sem reviewer LLM — gate determinístico decide sozinho")
  const spec = REVIEWER_BINS[id]
  if (!spec) return unavailable(id, `reviewer desconhecido: ${id} (disponíveis: ${knownReviewers().join(", ")})`)
  if (!binAvailable(spec.file, exec)) return unavailable(id, `binário '${spec.file}' não encontrado — fallback determinístico`)
  return {
    id,
    available: true,
    mode: "advisory",
    review(step, execResult) {
      try {
        const out = exec(spec.file, spec.args(buildReviewPrompt(step, execResult)),
          { stdio: "pipe", shell: false, timeout: opts.timeoutMs || 120000, encoding: "utf-8" })
        return parseVerdict(String(out || ""))
      } catch (e) {
        return { ok: true, advisory: true, degraded: true, note: `reviewer falhou (${String(e.message || e).slice(0, 80)}) — cobertura reduzida` }
      }
    },
  }
}
