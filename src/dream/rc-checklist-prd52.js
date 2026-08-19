/**
 * Checklist de Release Candidate do PRD52 (S52.H — fechamento do programa).
 *
 * Espelha `rc-checklist-prd45..51.js`, com uma diferença de fundo que vale
 * declarar: o PRD52 não acrescentou capacidade nova ao produto — ele tirou a
 * folga das afirmações que já existiam. Um checklist que só listasse "entregue"
 * esconderia justamente o resultado do programa, que foi um placar CAINDO por
 * regra endurecida.
 *
 * Por isso o `prd52Readiness()` MEDE ao vivo em vez de congelar números: o
 * placar, a reconciliação, a matriz OS×Node e o estado dos hooks do Codex são
 * lidos do repositório a cada chamada. Um checklist com contagens digitadas
 * envelhece exatamente como as claims que este PRD passou a policiar — e seria
 * constrangedor.
 *
 * PENDÊNCIAS EXTERNAS não são itens de sprint. Elas ficam em
 * `PRD52_EXTERNAL_PENDING`, cada uma com o que falta e quem pode fechá-la;
 * nenhuma delas é dívida técnica, e nenhuma se fecha com trabalho neste
 * repositório.
 */
import { audit } from "./auditor.js"
import { reconciliarAudit } from "./claim-reconciler.js"
import { construirMatriz } from "../release/support-matrix.js"
import { statusDosHooksDoCodex } from "../harness/codex-hooks-status.js"
import { relatorioDaFronteira } from "../meta/prd52-boundaries.js"

export const PRD52_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd52.v1"

export const PRD52_RC_ITEMS = Object.freeze([
  {
    id: "P0.1", tier: "P0", sprint: "S52.A", version: "5.107.0", commit: "e225d92", status: "delivered",
    title: "claimId canônico + schemas §25/§26 + validadores puros, sem consumidor prematuro",
    proof: "tests/prd52_schemas.test.js",
  },
  {
    id: "P0.2", tier: "P0", sprint: "S52.B", version: "5.107.0", commit: "0b7e4b0", status: "delivered",
    title: "Dentes no contrato de claim: 7 regras verificadas contra o repo auditado; baseline antes/depois com motivo por claim",
    proof: "tests/claim_contract_teeth.test.js",
  },
  {
    id: "P0.3", tier: "P0", sprint: "S52.C", version: "5.107.0", commit: "c3f50c5", status: "delivered",
    title: "Recibo por claim ancorado por hash no commit lido; `contrato_mudou` detectado com arquivos intactos",
    proof: "tests/claim_receipt.test.js",
  },
  {
    id: "P0.4", tier: "P0", sprint: "S52.D", version: "5.107.0", commit: "58c05bb", status: "delivered",
    title: "Reconciliação executável (§26.1) e validade temporal do readiness gravado (§26.2)",
    proof: "tests/claim_reconcile_freshness.test.js",
  },
  {
    id: "P0.5", tier: "P0", sprint: "S52.E", version: "5.107.0", commit: "f81a66e", status: "delivered",
    title: "Matriz OS × Node derivada do CI, células `not_run` por ausência de evidência, com gate no publish-guard",
    proof: "tests/support_matrix.test.js",
  },
  {
    id: "P0.6", tier: "P0", sprint: "S52.F", version: "5.107.0", commit: "8468252", status: "delivered",
    title: "Hooks do Codex ligados à máquina real; certificação em máquina limpa preparada e NÃO executada",
    proof: "tests/codex_hooks_status.test.js",
  },
  {
    id: "P0.7", tier: "P0", sprint: "S52.G", version: "5.107.0", commit: "f88eb93", status: "delivered",
    title: "Fronteira PRD53/54 como gate por lista de exports — o PRD52 não implementa loop autônomo",
    proof: "tests/prd52_boundaries.test.js",
  },
  {
    id: "P1.1", tier: "P1", sprint: "S52.H", version: "5.107.0", commit: null, status: "delivered",
    title: "ADR-006 executado: `operation-registry` estendido com handler/alias/help/flags, campos opcionais e nunca inferidos",
    proof: "tests/operation_registry_fields.test.js",
  },
  {
    id: "P1.2", tier: "P1", sprint: "S52.H", version: "5.107.0", commit: null, status: "delivered",
    title: "Este checklist, agregado por `prd status` — o programa que audita os outros também se audita",
    proof: "tests/rc_checklist_prd52.test.js",
  },
])

/**
 * O que o PRD52 NÃO fecha, e por quê.
 *
 * Cada uma exige algo que não existe dentro deste repositório: uma máquina, uma
 * execução de CI, ou uma decisão humana. Declará-las como itens de sprint faria
 * o programa parecer incompleto por trabalho não feito, quando o que falta é
 * evidência que ninguém aqui pode produzir.
 */
export const PRD52_EXTERNAL_PENDING = Object.freeze([
  {
    id: "action_kernel_claim_conflict",
    blockedBy: "human_adjudication",
    missing: "o auditor rebaixou `action-kernel` para NOT_PROVED (o `e2eCommand` era nome de função) enquanto o recibo mostra a evidência intacta. As duas projeções discordam e nenhuma é autoridade sobre a outra: ou se escreve um E2E real, ou se declara que a capacidade é provada por teste de módulo. Escolher pelo comando seria decidir em silêncio.",
    owner: "lucas",
  },
  {
    id: "os_node_matrix_not_run",
    blockedBy: "external_ci_execution",
    missing: "as 12 células nascem `not_run` porque `runtime-compat.yml` nunca rodou no GitHub. Fechar exige a execução, não uma edição da matriz.",
    owner: "lucas",
  },
  {
    id: "codex_enforcement_unobserved",
    blockedBy: "external_clean_machine",
    missing: "os 6 hooks estão registrados e com entrada de confiança nesta máquina, mas ler arquivo prova REGISTRO, nunca EXECUÇÃO. O passo `enforcement` do plano de máquina limpa é o que fecha — e o plano se recusa a rodar aqui, porque esta máquina não é limpa.",
    owner: "lucas",
  },
])

const isDelivered = (i) => i.status === "delivered"

/**
 * As medições AO VIVO que decidem o estado externo.
 *
 * Injetáveis para teste, e com uma razão além da testabilidade: quem chama pode
 * medir contra outro repositório (o tarball, por exemplo) sem que este módulo
 * precise saber disso.
 */
export function medicoesAoVivo({ repoRoot = process.cwd(), commit = null } = {}) {
  const a = audit({ behavioral: true, receipts: true, commit })
  const rec = reconciliarAudit(a)
  const matriz = construirMatriz({ cwd: repoRoot })
  const hooks = statusDosHooksDoCodex()
  const fronteira = relatorioDaFronteira(repoRoot)
  return {
    scoreboard: a.summary,
    reconciliation: rec.byVerdict,
    reconciliationInvalid: rec.invalidRecords.length,
    supportMatrix: { total: matriz.cells.length, proven: matriz.proven.length, counts: matriz.counts },
    codexHooks: { byState: hooks.byState, enforcementObserved: hooks.enforcementObserved },
    boundaryEnforced: fronteira.enforced,
  }
}

/**
 * Prontidão de RC do PRD52.
 *
 * `ready` fala do que ESTE programa controla: os P0 entregues, nenhum registro
 * de reconciliação inválido e a fronteira com o PRD53/54 conferida. Note que ele
 * NÃO exige placar cheio — o programa entregou a régua que derrubou uma claim, e
 * condicionar `ready` ao placar faria o gate punir o próprio trabalho de tê-lo
 * endurecido.
 *
 * `fullyValidated` é o oposto: só é verdadeiro quando NADA depende de fora. Com
 * três pendências externas abertas, ele é `false`, e é assim que tem de ser até
 * a máquina, o CI e a decisão humana existirem.
 */
export function prd52Readiness(items = PRD52_RC_ITEMS, opts = {}) {
  const medicoes = opts.medicoes || medicoesAoVivo(opts)
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => !isDelivered(i))
  const p1Open = items.filter((i) => i.tier === "P1" && !isDelivered(i))
  const externalOpen = opts.externalPending || PRD52_EXTERNAL_PENDING

  return {
    schemaVersion: PRD52_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0 && medicoes.reconciliationInvalid === 0 && medicoes.boundaryEnforced === true,
    programComplete: items.every(isDelivered),
    // Nada é declarado validado enquanto houver evidência que só existe fora.
    fullyValidated: externalOpen.length === 0,
    measurements: medicoes,
    counts: {
      p0: p0.length, p0Delivered: p0.length - p0Pending.length,
      p1: items.filter((i) => i.tier === "P1").length, p1Open: p1Open.length,
      externalPending: externalOpen.length,
    },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    externalPending: externalOpen,
    items,
  }
}
