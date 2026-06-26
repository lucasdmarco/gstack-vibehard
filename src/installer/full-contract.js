/**
 * Contrato Full (PRD 12 §11 / auditoria P1-#7): "Full = tudo" não pode terminar
 * como CONCLUÍDO se um componente do completo falhou em silêncio. Esta é a lógica
 * PURA do gate: dado o que degradou + o modo + o opt-in, decide se BLOQUEIA. O
 * install rastreia `report.degraded` e chama isto antes de declarar concluído.
 *
 * Regra: no modo FULL (não project-only, não audit-only, deps incluídas) qualquer
 * componente degradado BLOQUEIA, a menos que `--allow-degraded` seja explícito.
 * Lite/project-only TOLERAM (não bloqueiam) — degradação só é avisada.
 */

/** Registra um componente degradado no report (idempotente por componente+motivo). */
export function trackDegraded(report, component, reason) {
  if (!report) return
  if (!Array.isArray(report.degraded)) report.degraded = []
  if (report.degraded.some((d) => d.component === component)) return
  report.degraded.push({ component, reason: String(reason || "indisponível") })
}

/**
 * Avalia o contrato. → { block, isFull, degraded, message }.
 * `block=true` ⇒ o install NÃO deve declarar "concluído" e deve sair com erro.
 */
export function evaluateFullContract(opts = {}) {
  const degraded = Array.isArray(opts.degraded) ? opts.degraded : []
  const isFull = !opts.projectOnly && !opts.auditOnly && !opts.skipDeps
  const n = degraded.length

  if (!isFull) {
    return { block: false, isFull, degraded, message: n ? `${n} componente(s) degradado(s) — tolerado (modo não-Full)` : "ok" }
  }
  if (n === 0) return { block: false, isFull, degraded, message: "Full: todos os componentes OK" }
  if (opts.allowDegraded) {
    return { block: false, isFull, degraded, message: `instalação DEGRADADA: ${n} componente(s) — prosseguindo (--allow-degraded)` }
  }
  return {
    block: true, isFull, degraded,
    message: `Contrato Full NÃO cumprido: ${n} componente(s) degradado(s). Conserte ou rode com --allow-degraded.`,
  }
}
