/**
 * Evidence pack do PRD52 (§19 do PRD53) — o que foi medido, e o que NÃO foi.
 *
 * Um evidence pack é onde a tentação de arredondar é maior: é o documento que
 * alguém abre meses depois para decidir se pode confiar num programa, e quase
 * sempre é escrito por quem quer que a resposta seja sim.
 *
 * Por isso este módulo tem duas metades de igual importância. A primeira mede o
 * estado real: placar, reconciliação, recibos ancorados por hash, matriz de
 * suporte, hooks do Codex, fronteira. A segunda é `notMeasured` — a lista
 * explícita do que este pack NÃO prova, com o motivo. Sem ela, o silêncio sobre
 * o CI e sobre a máquina limpa pareceria ausência de problema.
 *
 * O pack é DERIVADO a cada geração e ancorado no commit. Não há campo escrito à
 * mão: se um número aqui estiver errado, o erro está na medição, e não numa
 * transcrição — que é a única forma de um documento assim envelhecer com honra.
 */

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { audit } from "./auditor.js"
import { reconciliarAudit } from "./claim-reconciler.js"
import { prd52Readiness, PRD52_EXTERNAL_PENDING } from "./rc-checklist-prd52.js"
import { construirMatriz } from "../release/support-matrix.js"
import { statusDosHooksDoCodex } from "../harness/codex-hooks-status.js"
import { relatorioDaFronteira } from "../meta/prd52-boundaries.js"
import { planoDeCertificacao } from "../release/clean-machine-e2e.js"

export const PRD52_EVIDENCE_PACK_SCHEMA = "gstack.prd52.evidence-pack.v1"

/** Onde o pack vive. O portão do PRD53 confere exatamente este caminho. */
export const EVIDENCE_PACK_PATH = join(".gstack", "evidence", "prd52-final.json")

/**
 * O que este pack NÃO prova, e por quê.
 *
 * Cada item é uma afirmação que alguém poderia supor lendo o resto do documento.
 * Deixá-las implícitas seria mentir por omissão — a forma mais barata de mentir
 * num pacote de evidência.
 */
function naoMedido({ matriz, hooks, plano }) {
  return [
    {
      claim: "o pacote funciona nos três sistemas operacionais e nas quatro versões de Node",
      why: `NÃO medido: ${matriz.proven.length}/${matriz.cells.length} células provadas — runtime-compat.yml nunca rodou no GitHub`,
    },
    {
      claim: "a instalação limpa funciona do zero",
      why: `NÃO medido: ${plano.runnable ? "máquina limpa disponível, execução não realizada" : `esta máquina não é limpa (${plano.blockers.map((b) => b.id).join(", ")})`}`,
    },
    {
      claim: "os hooks do Codex bloqueiam de verdade",
      why: `NÃO medido: enforcementObserved=${hooks.enforcementObserved} — ler arquivo prova REGISTRO, nunca EXECUÇÃO`,
    },
    {
      claim: "o pacote publicado no npm corresponde a este commit",
      why: "NÃO medido: nada foi publicado nesta linha de trabalho, e o token exposto segue pendente de rotação humana",
    },
    {
      claim: "a suíte passa em máquina fria",
      why: "NÃO medido: a suíte passa NESTA máquina, que não é fria",
    },
  ]
}

/** Uma claim reduzida ao que o pack precisa guardar: status e recibo ancorado. */
const claimDoPack = (c) => ({
  id: c.id,
  status: c.status,
  receipt: c.receipt
    ? {
      sourceCommit: c.receipt.sourceCommit,
      contractHash: c.receipt.contractHash,
      evidence: c.receipt.observedEvidenceRefs.map((r) => ({ path: r.path, sha256: r.sha256, state: r.state })),
    }
    : null,
})

/**
 * Monta o pack. PURO em relação ao disco de saída: quem escreve é `gravarPack`.
 *
 * `commit` entra de fora pela mesma razão de sempre neste repositório — quem
 * sabe qual é o HEAD relevante é o comando, não o construtor. E sem commit o
 * pack sai com `sourceCommit: null`, que o próprio §26.1 recusa: um pack sem
 * proveniência não vale como entrada de nada.
 */
export function buildEvidencePack({ repoRoot = process.cwd(), commit = null } = {}) {
  const auditoria = audit({ behavioral: true, receipts: true, commit })
  const reconciliacao = reconciliarAudit(auditoria)
  const readiness = prd52Readiness(undefined, { repoRoot, commit })
  const matriz = construirMatriz({ cwd: repoRoot })
  const hooks = statusDosHooksDoCodex()
  const plano = planoDeCertificacao()

  return {
    schemaVersion: PRD52_EVIDENCE_PACK_SCHEMA,
    prd: "PRD52",
    sourceCommit: commit,
    generatedAt: new Date().toISOString(),
    readiness: {
      ready: readiness.ready,
      programComplete: readiness.programComplete,
      fullyValidated: readiness.fullyValidated,
      counts: readiness.counts,
    },
    scoreboard: auditoria.summary,
    reconciliation: { byVerdict: reconciliacao.byVerdict, invalidRecords: reconciliacao.invalidRecords },
    claims: auditoria.claims.filter((c) => c.receipt).map(claimDoPack),
    supportMatrix: { total: matriz.cells.length, proven: matriz.proven, counts: matriz.counts },
    codexHooks: { byState: hooks.byState, enforcementObserved: hooks.enforcementObserved },
    boundary: { enforced: relatorioDaFronteira(repoRoot).enforced },
    externalPending: PRD52_EXTERNAL_PENDING,
    notMeasured: naoMedido({ matriz, hooks, plano }),
  }
}

const listaVazia = (v) => !Array.isArray(v) || v.length === 0
const claimsSemRecibo = (pack) => (pack.claims || []).filter((c) => !c.receipt || !c.receipt.sourceCommit)

const REGRAS_DO_PACK = Object.freeze([
  {
    quando: (pack) => !pack.sourceCommit,
    problema: () => "sourceCommit ausente — pack sem proveniência não ancora nada",
  },
  {
    quando: (pack) => listaVazia(pack.claims),
    problema: () => "nenhuma claim com recibo",
  },
  {
    quando: (pack) => listaVazia(pack.notMeasured),
    problema: () => "`notMeasured` vazio — um pack que não declara o que NÃO provou mente por omissão",
  },
  {
    quando: (pack) => claimsSemRecibo(pack).length > 0,
    problema: (pack) => `claim(s) sem recibo ancorado: ${claimsSemRecibo(pack).map((c) => c.id).join(", ")}`,
  },
])

/**
 * Problemas do pack. Um pack inválido não vale como entrada — e a primeira
 * regra é a que mais dói: sem commit, nada do resto importa.
 */
export function problemasDoPack(pack) {
  if (!pack || typeof pack !== "object") return ["pack não é objeto"]
  return REGRAS_DO_PACK.filter((r) => r.quando(pack)).map((r) => r.problema(pack))
}

/** Grava o pack e devolve o caminho + o hash do que foi escrito. */
export function gravarPack(pack, { repoRoot = process.cwd() } = {}) {
  const destino = join(repoRoot, EVIDENCE_PACK_PATH)
  mkdirSync(dirname(destino), { recursive: true })
  const texto = `${JSON.stringify(pack, null, 2)}\n`
  writeFileSync(destino, texto)
  return { path: EVIDENCE_PACK_PATH, sha256: `sha256:${createHash("sha256").update(texto).digest("hex")}` }
}
