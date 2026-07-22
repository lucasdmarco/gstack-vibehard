/**
 * PRD48 S48.6 — catálogo PT-BR (default/fallback desta migração). IDs estáveis — mudar o
 * TEXTO nunca muda a chave nem o exit code. Enums/keys de `--json` NUNCA vêm daqui (JSON
 * nunca traduz — só o texto humano em stderr/stdout humano usa este catálogo).
 */
export default {
  "task.session_not_found": "sessão não encontrada: {sessionId}",
  "task.checkpoint.confirmation_required": "restaurar pro checkpoint {seq} do run {runId}? rode de novo com --yes pra confirmar.",
  "task.checkpoint.restore_failed": "restore falhou: {reason}",
  "task.checkpoint.restored": "restaurado pro checkpoint {seq} ({count} arquivo(s); recibo {receipt})",
}
