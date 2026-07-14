/**
 * Probes PUROS/injetáveis (PRD42 S42.0B): mapeiam EVIDÊNCIA observada → estado tipado.
 * Sem chamadas reais de rede/Docker — o E2E de backend vivo é o S42.0D. A regra dura:
 * presença de arquivo/config = `configured`, NUNCA `healthy` (isso exige runtime real).
 */

/** installState a partir de sinais de disco/pacote. Arquivo presente ≠ instalado. */
export function probeInstallState(ev = {}) {
  if (ev.failed) return "failed"
  if (ev.packageInstalled) return "installed"
  if (ev.configPresent) return "configured"
  return "absent"
}

/** runtimeState a partir de alcance/saúde observados. Só `healthy` com health real. */
export function probeRuntimeState(ev = {}) {
  if (ev.supported === false) return "unsupported"
  if (ev.healthy) return "healthy"
  if (ev.reachable) return "degraded"
  return "not_started"
}
