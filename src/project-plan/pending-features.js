/**
 * Registro único de FEATURES FUTURAS (PRD hardening PR8). Permite que planos
 * mostrem recursos de roadmap SEM mentir que existem: cada entrada é
 * `status: "pending_feature"` e NUNCA carrega comando executável.
 *
 * O `planner.expandStep` consulta este registro; o executor nunca roda um step
 * com `pendingFeature:true` (garantido por `executor.js`).
 */

export const PENDING_FEATURES = Object.freeze({
  "runtime:start": { id: "runtime:start", label: "Iniciar runtime do projeto", explanation: "Runtime manager local — ainda não implementado (roadmap)." },
  "runtime:logs": { id: "runtime:logs", label: "Ver logs do runtime", explanation: "Streaming de logs do runtime — roadmap." },
  "runtime:open": { id: "runtime:open", label: "Abrir o app do runtime", explanation: "Abrir a app servida pelo runtime — roadmap." },
  "dashboard:open": { id: "dashboard:open", label: "Abrir o dashboard", explanation: "Painel de planos/tasks/runs — roadmap (contrato no PR futuro)." },
  "deploy:preview": { id: "deploy:preview", label: "Deploy de preview", explanation: "Deploy de pré-visualização — roadmap." },
  "deploy:production": { id: "deploy:production", label: "Deploy de produção", explanation: "Deploy de produção — roadmap (exigirá confirmação explícita)." },
})

export function isPendingFeature(id) {
  return Object.prototype.hasOwnProperty.call(PENDING_FEATURES, id)
}

export function getPendingFeature(id) {
  return PENDING_FEATURES[id] || null
}
