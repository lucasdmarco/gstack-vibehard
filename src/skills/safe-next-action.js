/**
 * PRD51 S51.7.3 — "uma próxima ação segura para cada falha importante"
 * (PRD48 §3.2 P2.2, o único item da checklist que NENHUM sprint anterior
 * endereçou: `sprint: "-"`, `status: "pending"`, `proof: null`).
 *
 * Achado que motivou o módulo: o repo JÁ tinha próximas-ações reais e boas —
 * mas ad hoc, cada uma num formato próprio, e só em 2 superfícies
 * (`design-system.js:requiredActionFor`, o handoff do pipeline em
 * `start.js`). As demais falhas importantes (first-run bloqueado, plano/brief
 * inválido, proof reprovado, policy `deny`) reportavam o problema e paravam
 * ali — sem dizer o que fazer em seguida.
 *
 * Este módulo NÃO é um framework: é UMA forma pequena e compartilhada
 * (`{ failureId, humanText, command|null, safe }`) mais um registro dos
 * casos reais. `safe:true` significa que rodar o comando sugerido não
 * destrói trabalho nem contorna gate — é sempre diagnóstico/retomada. Nunca
 * sugere `--force`, nunca sugere desligar um gate.
 */
export const SAFE_NEXT_ACTION_SCHEMA = "gstack.safe-next-action.v1"

/**
 * Registro das falhas REAIS que hoje têm superfície no produto. Cada entrada
 * aponta a próxima ação segura — nunca um contorno. `command:null` quando a
 * ação é uma decisão humana (não há comando que resolva sozinho).
 */
const ACTIONS = Object.freeze({
  // first-run: nenhum harness apto e a tarefa exige LLM (`onboarding/first-run.js`).
  first_run_blocked: {
    humanText: "Instale/abra um harness suportado (Claude Code, Codex ou OpenCode) e rode de novo — ou siga sem LLM usando os gates determinísticos.",
    command: "gstack_vibehard doctor",
  },
  // plano/brief inválido no `start` (validation.errors).
  plan_invalid: {
    humanText: "Revise o objetivo e responda o assistente de novo — nada foi escrito.",
    command: null,
  },
  // pipeline parou em handoff (gate falho). Já existia em start.js — aqui vira forma compartilhada.
  pipeline_handoff: {
    humanText: "Leia o handoff do run e retome do ponto exato quando resolver — nenhum trabalho foi perdido.",
    command: null,
  },
  // proof reprovado (blockers reais).
  proof_blocked: {
    humanText: "Resolva os bloqueios listados e rode o proof de novo — cada bloqueio traz a razão real.",
    command: "gstack_vibehard proof --profile release",
  },
  // policy negou a ação (Policy DSL `deny`).
  policy_denied: {
    humanText: "A policy do projeto nega essa ação. Se for legítima, mude a policy pelo comando dedicado (nunca por bypass).",
    command: "gstack_vibehard policy show",
  },
  // design system ausente/incompleto bloqueando escrita de UI.
  design_system_missing: {
    humanText: "Declare o design system antes de escrever UI (ou opte por sair explicitamente).",
    command: null,
  },
})

export const KNOWN_FAILURE_IDS = Object.freeze(Object.keys(ACTIONS))

/**
 * Próxima ação segura de uma falha conhecida. `detail` (opcional) é anexado
 * como contexto REAL da ocorrência — nunca substitui o texto base.
 * Falha desconhecida devolve `null` (honesto: nunca inventa uma ação).
 */
export function safeNextAction(failureId, detail = null) {
  const entry = ACTIONS[failureId]
  if (!entry) return null
  return {
    schemaVersion: SAFE_NEXT_ACTION_SCHEMA,
    failureId,
    humanText: entry.humanText,
    command: entry.command,
    safe: true,
    ...(detail ? { detail: String(detail).slice(0, 300) } : {}),
  }
}

/** Linha única pronta pra CLI. `null` quando a falha não tem ação registrada. */
export function renderSafeNextAction(action) {
  if (!action) return null
  return action.command ? `Próxima ação segura: ${action.humanText} → ${action.command}` : `Próxima ação segura: ${action.humanText}`
}
