/**
 * Registro único de FEATURES FUTURAS (PRD hardening PR8). Permite que planos
 * mostrem recursos de roadmap SEM mentir que existem: cada entrada é
 * `status: "pending_feature"` e NUNCA carrega comando executável.
 *
 * O `planner.expandStep` consulta este registro; o executor nunca roda um step
 * com `pendingFeature:true` (garantido por `executor.js`).
 */

export const PENDING_FEATURES = Object.freeze({
  // runtime:start/logs/open NÃO são mais pending: o supervisor existe
  // (`dev`/`logs`/`open`/`stop`) e todo template do `create` declara
  // .gstack/runtime.json — o planner expande para o comando real (PRD14 §4.14).
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
