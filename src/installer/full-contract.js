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

/**
 * Registra um componente degradado no report (idempotente por componente+motivo).
 * `opts.optional=true` (P3 da máquina limpa): componente NICE-TO-HAVE (ex.:
 * obsidian-app — o vault markdown segue funcional sem o app GUI) degrada para
 * WARNING e não reprova o contrato Full. Componentes do core continuam bloqueando.
 */
export function trackDegraded(report, component, reason, opts = {}) {
  if (!report) return
  if (!Array.isArray(report.degraded)) report.degraded = []
  if (report.degraded.some((d) => d.component === component)) return
  report.degraded.push({ component, reason: String(reason || "indisponível"), optional: opts.optional === true })
}

/**
 * Avalia o contrato. → { block, isFull, degraded, message }.
 * `block=true` ⇒ o install NÃO deve declarar "concluído" e deve sair com erro.
 */
export function evaluateFullContract(opts = {}) {
  const degraded = Array.isArray(opts.degraded) ? opts.degraded : []
  const isFull = !opts.projectOnly && !opts.auditOnly && !opts.skipDeps
  // Só componentes OBRIGATÓRIOS bloqueiam; opcionais degradados viram warning.
  const required = degraded.filter((d) => d.optional !== true)
  const optionalN = degraded.length - required.length
  const optNote = optionalN ? ` (+${optionalN} opcional(is) degradado(s) — warning, não bloqueia)` : ""
  const n = required.length

  if (!isFull) {
    return { block: false, isFull, degraded, message: degraded.length ? `${degraded.length} componente(s) degradado(s) — tolerado (modo não-Full)` : "ok" }
  }
  if (n === 0) return { block: false, isFull, degraded, message: `Full: componentes obrigatórios OK${optNote}` }
  if (opts.allowDegraded) {
    return { block: false, isFull, degraded, message: `instalação DEGRADADA: ${n} componente(s) — prosseguindo (--allow-degraded)${optNote}` }
  }
  return {
    block: true, isFull, degraded,
    message: `Contrato Full NÃO cumprido: ${n} componente(s) obrigatório(s) degradado(s). Conserte ou rode com --allow-degraded.${optNote}`,
  }
}
