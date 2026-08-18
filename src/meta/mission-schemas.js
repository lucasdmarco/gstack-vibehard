/**
 * Schemas do §25 — missão autônoma. DADOS E INVARIANTES, sem motor.
 *
 * A divisão é decisão humana e está registrada: o PRD52 possui os schemas, as
 * invariantes e a validação FAIL-CLOSED; o PRD53 possui avaliação adversarial e
 * promoção; o PRD54 possui motor, scheduler, lifecycle, renovação, revogação e
 * recovery. **Este módulo não implementa loop autônomo** — não há aqui execução,
 * agendamento nem decisão de continuar.
 *
 * O QUE ELE FAZ é impedir que o motor do PRD54, quando existir, possa mentir por
 * construção: uma lease que não cobre a ação não passa na validação; um budget
 * que reinicia não passa; uma observação de consumo estimada não vira percentual.
 */

import { problemas, camposObrigatorios, doVocabulario, naoEhObjeto } from "./schema-rules.js"

export const MISSION_SCHEMAS_VERSION = "gstack.mission.v1"

// ═══════════════════════════════════════════════════════════════════════════
//  §25.1 — Uma ApprovalLease por missão autorizada
// ═══════════════════════════════════════════════════════════════════════════

export const APPROVAL_LEASE_SCHEMA = "gstack.approval-lease.v1"

/**
 * Os hashes que definem a FRONTEIRA da missão. Enquanto os quatro forem iguais,
 * a continuidade é automática: o usuário aprovou a fronteira uma vez, e pedir
 * confirmação por comando, retry ou retomada seria cobrar de novo o que já foi
 * dado.
 */
export const LEASE_BOUNDARY_FIELDS = Object.freeze([
  "planHash", "scopeHash", "policyHash", "worktreeId",
])

export const APPROVAL_LEASE_FIELDS = Object.freeze([
  "leaseId", "missionId", ...LEASE_BOUNDARY_FIELDS,
  "paths", "tools", "commands", "network",
  "budget", "externalEffects", "expiresAt",
])

/** Toda entrada pedida precisa estar na lista aprovada. Lista ausente = nada aprovado. */
function listaCobre(aprovado, pedido) {
  const p = pedido || []
  const a = new Set(aprovado || [])
  return p.every((x) => a.has(x))
}

/** As dimensões de lista em que a ação precisa caber. */
const DIMENSOES_DA_LEASE = Object.freeze(["paths", "tools", "commands", "externalEffects"])

/**
 * A ação está DENTRO da fronteira aprovada?
 *
 * Fail-closed em cada dimensão: path fora da lista, ferramenta não listada,
 * comando não coberto ou rede não autorizada devolvem `false`. Não há "quase
 * coberto" — ampliar materialmente a fronteira exige aprovação nova, e é a
 * única coisa que exige.
 */
export function acaoCobertaPelaLease(lease, acao) {
  if (!lease || !acao) return false
  const pedeRede = acao.network === true && lease.network !== true
  if (pedeRede) return false
  return DIMENSOES_DA_LEASE.every((d) => listaCobre(lease[d], acao[d]))
}

/** As razões pelas quais uma lease deixa de valer, em ordem de checagem. */
const INVALIDACOES_DA_LEASE = Object.freeze([
  ...LEASE_BOUNDARY_FIELDS.map((f) => ({
    when: (l, ctx) => l[f] !== ctx[f],
    reason: () => `fronteira_mudou:${f}`,
  })),
  {
    when: (l) => !Number.isFinite(Date.parse(l.expiresAt ?? "")),
    reason: () => "validade_ausente",
  },
  {
    when: (l, _ctx, agoraMs) => agoraMs > Date.parse(l.expiresAt),
    reason: () => "lease_expirada",
  },
])

/**
 * A lease continua valendo para esta retomada?
 *
 * A fronteira precisa ser IDÊNTICA. Um plano que mudou, um escopo que cresceu ou
 * outra worktree são outra missão — e continuar sob a lease antiga usaria uma
 * aprovação dada para outra coisa.
 */
export function leaseAindaVale(lease, contextoAtual, agoraMs) {
  if (!lease || !contextoAtual) return { ok: false, reason: "lease_ou_contexto_ausente" }
  const falha = INVALIDACOES_DA_LEASE.find((i) => i.when(lease, contextoAtual, agoraMs))
  return falha ? { ok: false, reason: falha.reason() } : { ok: true, reason: null }
}

const REGRAS_DA_LEASE = Object.freeze([
  ...camposObrigatorios(APPROVAL_LEASE_FIELDS),
  {
    when: (l) => l.expiresAt !== undefined && !Number.isFinite(Date.parse(l.expiresAt)),
    problem: () => "expiresAt inválida — lease sem validade não expira nunca",
  },
])

export function problemasDaLease(l) {
  if (naoEhObjeto(l)) return ["lease não é objeto"]
  return problemas(l, REGRAS_DA_LEASE)
}

// ═══════════════════════════════════════════════════════════════════════════
//  §25.2 — Checkpoint independente do harness
// ═══════════════════════════════════════════════════════════════════════════

export const MISSION_CHECKPOINT_SCHEMA = "gstack.mission-checkpoint.v1"

export const MISSION_CHECKPOINT_FIELDS = Object.freeze([
  "missionId", "runId", "planHash", "worktreeRef", "completedTaskIds",
  "currentTaskId", "nextActionRef", "cumulativeUsage", "stopReason",
  "providerRef", "harnessRef", "createdAt",
])

const REGRAS_DO_CHECKPOINT = Object.freeze([
  ...camposObrigatorios(MISSION_CHECKPOINT_FIELDS),
  {
    when: (c) => c.completedTaskIds !== undefined && !Array.isArray(c.completedTaskIds),
    problem: () => "completedTaskIds precisa ser lista — trabalho concluído é enumerável",
  },
  {
    // `nextActionRef` é REFERÊNCIA, nunca texto livre: reconstruir a próxima
    // ação a partir de prosa faria a retomada depender do transcript — que é
    // exatamente o que fechar, compactar ou trocar de harness destrói.
    when: (c) => typeof c.nextActionRef === "string" && c.nextActionRef.includes(" "),
    problem: () => "nextActionRef parece prosa: a próxima ação é REFERÊNCIA, não texto reconstruído",
  },
])

/** O checkpoint pertence ao GStack, não à conversa. */
export function problemasDoCheckpoint(c) {
  if (naoEhObjeto(c)) return ["checkpoint não é objeto"]
  return problemas(c, REGRAS_DO_CHECKPOINT)
}

// ═══════════════════════════════════════════════════════════════════════════
//  §25.3 — Budget cumulativo e observação de uso
// ═══════════════════════════════════════════════════════════════════════════

export const USAGE_OBSERVATION_SCHEMA = "gstack.usage-observation.v1"

/** `unknown` NUNCA vira zero, suficiente ou percentual aparente. */
export const USAGE_BASIS = Object.freeze(["measured", "estimated", "unknown"])

/** Denominadores DISTINTOS: quota da conta não é budget da missão. */
export const USAGE_SUBJECTS = Object.freeze(["mission_budget", "provider_quota"])

export const USAGE_OBSERVATION_FIELDS = Object.freeze([
  "usageBasis", "subject", "consumed", "limit", "unit", "observedAt", "sourceRef",
])

const REGRAS_DA_OBSERVACAO_DE_USO = Object.freeze([
  ...camposObrigatorios(USAGE_OBSERVATION_FIELDS),
  doVocabulario("usageBasis", USAGE_BASIS),
  doVocabulario("subject", USAGE_SUBJECTS),
  {
    // `measured` EXIGE fonte observável — é o que separa medida de estimativa.
    when: (o) => o.usageBasis === "measured" && !o.sourceRef,
    problem: () => "`measured` sem `sourceRef` é estimativa com outro nome",
  },
])

export function problemasDaObservacaoDeUso(o) {
  if (naoEhObjeto(o)) return ["observação não é objeto"]
  return problemas(o, REGRAS_DA_OBSERVACAO_DE_USO)
}

/**
 * Percentual, ou `null`.
 *
 * SÓ `measured` produz percentual exato. `estimated` e `unknown` devolvem `null`
 * — e `null` é o ponto: um percentual aparente calculado sobre estimativa vira
 * número na tela do usuário, e ele decide com ele.
 */
export function percentualDeUso(o) {
  if (!o || o.usageBasis !== "measured") return null
  const c = Number(o.consumed)
  const l = Number(o.limit)
  if (!Number.isFinite(c) || !Number.isFinite(l) || l <= 0) return null
  return c / l
}

/**
 * O limiar de 90% aplica-se SOMENTE ao budget da missão quando não há sinal
 * oficial do provider. Aplicá-lo à quota da conta sem sinal seria inventar o
 * denominador de outra pessoa.
 */
export function atingiuLimiar(o, limiar = 0.9) {
  if (!o || o.subject !== "mission_budget") return false
  const pct = percentualDeUso(o)
  return pct !== null && pct >= limiar
}

/**
 * Budget é CUMULATIVO entre workers, subagentes, retries, fallback, troca de
 * modelo/harness, reinício de processo e retomada.
 *
 * A soma ignora `unknown` em vez de tratá-lo como zero, e DECLARA que ignorou:
 * um total que absorve o desconhecido como zero afirma um consumo menor que o
 * real, e é assim que um budget estoura sem aviso.
 */
export function consumoCumulativo(observacoes, subject = "mission_budget") {
  const doAssunto = (observacoes || []).filter((o) => o && o.subject === subject)
  const contadas = doAssunto.filter((o) => o.usageBasis !== "unknown")
  const desconhecidas = doAssunto.length - contadas.length
  return {
    consumed: contadas.reduce((n, o) => n + (Number(o.consumed) || 0), 0),
    counted: contadas.length,
    unknownObservations: desconhecidas,
    // Com qualquer observação `unknown`, o total é PISO e não medida.
    basis: desconhecidas > 0 ? "lower_bound" : "complete",
  }
}
