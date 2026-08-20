/**
 * Portão de ENTRADA do PRD54 (Sprint 54.0).
 *
 * Mesmo desenho do portão do PRD53, mesma disciplina, e por um motivo que não é
 * simetria estética: o §2 do PRD54 diz "retorna `blocked` se qualquer item
 * abaixo não estiver provado NO MESMO COMMIT". Um portão que aceitasse prova de
 * outro commit — ou nenhuma — deixaria o programa mais pesado do repositório
 * começar sobre o vazio.
 *
 * O que este portão tem a mais é o §2.1: um P0 de runtime Windows que a
 * auditoria REPRODUZIU (stop com `access_denied`, processo sobrevivendo ao
 * supervisor, porta e log presos, cleanup em `EBUSY`). O §2.1 lista oito provas
 * exigidas e diz, textualmente, que `taskkill /T /F` isolado não satisfaz o
 * contrato. Nenhuma delas se prova por leitura de código — todas exigem
 * execução, e várias exigem 20 execuções.
 *
 * Por isso o critério do P0 nasce `unproven` e assim fica: declarar `met` porque
 * o supervisor "parece" ter ownership seria exatamente o tipo de afirmação que o
 * PRD52 passou um programa inteiro removendo deste repositório.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { prd53EntryGate } from "./prd53-entry-gate.js"
import { prd52Readiness } from "./rc-checklist-prd52.js"
import { ledgerDoP0Runtime, PROVAS_DO_P0 } from "../runtime/lifecycle-proof-ledger.js"

export const PRD54_ENTRY_GATE_SCHEMA = "gstack.prd54.entry-gate.v1"

export const ESTADOS_DO_CRITERIO = Object.freeze(["met", "unproven", "failed"])

const criterio = (id, source, estado, detalhe) => ({ id, source, state: estado, detail: detalhe })
const met = (id, source, d) => criterio(id, source, "met", d)
const unproven = (id, source, d) => criterio(id, source, "unproven", d)

/**
 * As OITO provas que o §2.1 exige do lifecycle de runtime no Windows.
 *
 * Ficam nomeadas aqui e não em prosa porque cada uma é um experimento distinto:
 * quem for fechar o P0 precisa saber o que medir, e "o supervisor funciona" não
 * é mensurável. A lista é o roteiro.
 */
/**
 * DERIVADO do ledger, e não uma segunda lista (S54.2).
 *
 * Até aqui as oito provas estavam escritas em dois lugares: aqui, em prosa, e no
 * ledger, com evidência. Duas fontes sobre a mesma coisa é o defeito que este
 * repositório passou o PRD52 removendo dos outros lugares — e o modo de falha é
 * silencioso, porque a lista decorativa continua parecendo certa depois que a
 * outra muda.
 */
export const PROVAS_DO_P0_RUNTIME = Object.freeze(PROVAS_DO_P0.map((p) => p.titulo))

/** O artefato que o §17 exige do Sprint 54.0 — evidence pack do PRD53. */
export const EVIDENCE_PACK_PRD53 = join(".gstack", "evidence", "prd53-final.json")

/**
 * O P0 do §2.1, DERIVADO do ledger de provas (S54.2).
 *
 * Este critério nasceu `unproven` por CONSTANTE, com as oito provas em prosa.
 * Estava certo enquanto nenhuma existia, e passou a estar errado no instante em
 * que a primeira fechou: constante não muda quando o produto melhora, só quando
 * alguém lembra de editá-la — e "alguém lembra" é o mecanismo que o PRD52 passou
 * um programa inteiro tirando dos gates.
 *
 * Agora cada prova aponta para um teste conferido em disco, e o critério só vira
 * `met` com as OITO `proved`. `external` NÃO conta: as condições de shell
 * restrito e CI da prova 8 não se inferem da que rodou em Windows normal.
 */
function criterioP0Runtime(repoRoot) {
  const l = ledgerDoP0Runtime({ repoRoot })
  if (l.complete) return met("p0_runtime_windows_lifecycle", "lifecycle-proof-ledger", `as ${l.total} provas do §2.1 têm evidência executável`)
  return unproven("p0_runtime_windows_lifecycle", "lifecycle-proof-ledger",
    `${l.proved.length}/${l.total} provas fechadas. Sem evidência: ${l.unproved.join(", ") || "nenhuma"}. Dependentes de ambiente externo: ${l.external.join(", ") || "nenhuma"}. O §2.1 é explícito: \`taskkill /T /F\` isolado NÃO satisfaz o contrato.`)
}

/** O P1 do §2.2: run não observa workspace mudando por baixo. */
function criterioP1Workspace() {
  return unproven("p1_workspace_imutavel_durante_run", "prd54 §2.2",
    "toda missão precisa fixar `sourceCommit`, `workspaceSnapshotHash` e paths observados, e produzir `workspace_changed` + checkpoint quando o workspace mudar. Não há missão no produto (o motor é deste PRD), então não há o que medir ainda.")
}

/** Os predecessores: o §2 exige PRD52 E PRD53 concluídos, com packs rastreados. */
function criteriosDosPredecessores({ repoRoot, commit }) {
  const p53 = prd53EntryGate({ repoRoot, commit })
  const p52 = prd52Readiness(undefined, { repoRoot, commit })
  return [
    p52.fullyValidated
      ? met("prd52_concluido", "rc-checklist-prd52", "PRD52 com validação completa")
      : unproven("prd52_concluido", "rc-checklist-prd52",
        `PRD52 ready=${p52.ready} mas fullyValidated=false — ${p52.counts.externalPending} pendência(s) externa(s)`),
    p53.entered
      ? met("prd53_concluido", "prd53-entry-gate", "PRD53 entrou e concluiu")
      : unproven("prd53_concluido", "prd53-entry-gate",
        `o PRD53 nem ENTROU: ${p53.missing.length} critério(s) de entrada faltando (${p53.missing.map((m) => m.id).join(", ")})`),
    existsSync(join(repoRoot, EVIDENCE_PACK_PRD53))
      ? met("evidence_pack_prd53", "disco", `${EVIDENCE_PACK_PRD53} presente`)
      : unproven("evidence_pack_prd53", "disco",
        `ausente: ${EVIDENCE_PACK_PRD53} — o §17 exige o pack do PRD53, e o PRD53 não terminou`),
  ]
}

/**
 * O portão. Nada aqui executa, escreve ou promove.
 *
 * `entered` exige TODOS `met`, e hoje nenhum dos cinco está — o que é o
 * resultado correto: o PRD54 é o último da fila e depende de dois programas que
 * ainda não fecharam.
 */
export function prd54EntryGate({ repoRoot = process.cwd(), commit = null } = {}) {
  const criterios = [
    ...criteriosDosPredecessores({ repoRoot, commit }),
    criterioP0Runtime(repoRoot),
    criterioP1Workspace(),
  ]
  const faltando = criterios.filter((c) => c.state !== "met")
  return {
    schemaVersion: PRD54_ENTRY_GATE_SCHEMA,
    entered: faltando.length === 0,
    status: faltando.length === 0 ? "open" : "blocked",
    criteria: criterios,
    missing: faltando,
    p0Checklist: PROVAS_DO_P0_RUNTIME,
    note: faltando.length === 0
      ? "critérios do §2 comprovados: o PRD54 pode começar"
      : "PRD54 BLOQUEADO na entrada (§2) — o programa é o último da fila e depende de PRD52 e PRD53 fechados",
  }
}
