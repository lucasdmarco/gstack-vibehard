/**
 * Portão de ENTRADA do PRD53 (Sprint 53.0).
 *
 * O PRD53 abre com uma instrução categórica: "este programa começa somente
 * depois do PRD52 concluído e certificado", e o §2 lista o que precisa estar
 * comprovado. O mesmo §2 diz o que fazer quando não está: **`blocked`**.
 *
 * Este módulo é esse portão, e é deliberadamente incapaz de ser gentil. Ele não
 * pergunta se alguém acha que o PRD52 acabou — mede cada critério contra o
 * repositório e devolve o que falta, nomeado. Um portão que consulta a opinião
 * de quem quer passar não é portão.
 *
 * O QUE ELE NÃO FAZ: nada. Não escreve, não promove, não altera árvore de
 * código. O §19 é explícito — o Sprint 53.0 classifica e prova, sem mudar o
 * produto.
 *
 * E uma nota sobre o desfecho esperado: hoje ele bloqueia, e isso NÃO é defeito
 * nem do PRD52 nem deste código. Três das pendências dependem de máquina limpa,
 * de um run de CI e de rotação de segredo — nenhuma se resolve escrevendo mais
 * código aqui. Um portão que passasse assim mesmo seria decoração.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { prd52Readiness, PRD52_EXTERNAL_PENDING } from "./rc-checklist-prd52.js"
import { prd51Readiness } from "./rc-checklist-prd51.js"
import { construirMatriz } from "../release/support-matrix.js"
import { statusDosHooksDoCodex } from "../harness/codex-hooks-status.js"
import { planoDeCertificacao } from "../release/clean-machine-e2e.js"
import { deriveEngineGates } from "../project-plan/golden-run.js"
import { percentualDeUso, consumoCumulativo, acaoCobertaPelaLease, leaseAindaVale } from "../meta/mission-schemas.js"

export const PRD53_ENTRY_GATE_SCHEMA = "gstack.prd53.entry-gate.v1"

/**
 * Os estados de um critério. `unproven` é o default e nunca vira `met` por
 * omissão.
 *
 * `failed` NÃO é sinônimo de `unproven`, e a diferença decide o que alguém faz
 * a seguir: `unproven` é evidência que falta, `failed` é código que contradiz a
 * exigência. O primeiro se fecha produzindo prova; o segundo, mudando o produto.
 */
export const ESTADOS_DO_CRITERIO = Object.freeze(["met", "unproven", "failed"])

const criterio = (id, source, estado, detalhe) => ({ id, source, state: estado, detail: detalhe })

const met = (id, source, detalhe) => criterio(id, source, "met", detalhe)
const unproven = (id, source, detalhe) => criterio(id, source, "unproven", detalhe)
const failed = (id, source, detalhe) => criterio(id, source, "failed", detalhe)

/**
 * Os artefatos que o §19 exige do evidence pack, e que ainda não existem.
 *
 * Cada um é um CAMINHO conferido em disco. Declarar "o pack existe" sem apontar
 * arquivo seria a forma mais barata de fingir entrada.
 */
export const ARTEFATOS_DO_EVIDENCE_PACK = Object.freeze([
  { id: "evidence_pack", path: join(".gstack", "evidence", "prd52-final.json"), o_que: "evidence pack do commit final do PRD52 (§19)" },
  { id: "seed_corpus", path: join(".docs", "RESEARCH", "prd53-seed-corpus.json"), o_que: "seed corpus não promocional com greenfield, brownfield e controle negativo de segurança (§2)" },
])

const conta = (placar, chave) => Number(placar[chave]) || 0
const semClaimSuspeita = (p) => conta(p, "RISK") + conta(p, "PLACEBO") + conta(p, "NOT_PROVED") === 0

/**
 * Os critérios do §2 que se medem a partir do estado do PRD52.
 *
 * TABELA, e não uma cadeia de ternários: cada critério é `{ id, source, quando,
 * sim, nao }` e o runner monta o veredito. Acrescentar critério não aumenta a
 * complexidade de nenhuma função, e a lista de exigências fica legível como
 * lista — que é o que ela é.
 */
const CRITERIOS_DO_PRD52 = Object.freeze([
  {
    id: "prd52_ready", source: "rc-checklist-prd52",
    quando: (r) => r.ready === true,
    sim: () => "os P0 do PRD52 estão entregues e a reconciliação é válida",
    nao: (r) => `PRD52 não está ready: ${r.p0Pending.join(", ") || "reconciliação/fronteira"}`,
  },
  {
    id: "claims_coerentes", source: "claim-reconciler",
    quando: (r) => r.measurements.reconciliationInvalid === 0,
    sim: () => "ledger unificado sem registro de reconciliação inválido",
    nao: (r) => `${r.measurements.reconciliationInvalid} registro(s) de reconciliação inválido(s)`,
  },
  {
    id: "sem_claim_nao_provada", source: "dream-audit",
    quando: (r) => semClaimSuspeita(r.measurements.scoreboard),
    sim: (r) => `placar sem NOT_PROVED/RISK/PLACEBO: ${JSON.stringify(r.measurements.scoreboard)}`,
    nao: (r) => `placar ainda tem claim não provada: ${JSON.stringify(r.measurements.scoreboard)}`,
  },
])

function criteriosDoPrd52(readiness) {
  return CRITERIOS_DO_PRD52.map((c) => (c.quando(readiness)
    ? met(c.id, c.source, c.sim(readiness))
    : unproven(c.id, c.source, c.nao(readiness))))
}

/** Os critérios que dependem de evidência EXTERNA — máquina, CI, rotação humana. */
function criteriosExternos({ matriz, hooks, plano }) {
  return [
    matriz.proven.length > 0
      ? met("pacote_cross_os", "support-matrix", `${matriz.proven.length}/${matriz.cells.length} células provadas`)
      : unproven("pacote_cross_os", "support-matrix", `0/${matriz.cells.length} células provadas — o CI de runtime-compat nunca rodou`),
    plano.runnable && hooks.enforcementObserved
      ? met("clean_machine_certificado", "clean-machine-e2e", "certificação executada em máquina limpa")
      : unproven("clean_machine_certificado", "clean-machine-e2e",
        plano.runnable
          ? "máquina limpa disponível, mas o enforcement dos hooks nunca foi observado"
          : `máquina NÃO limpa (${plano.blockers.map((b) => b.id).join(", ")}) e enforcement não observado`),
  ]
}

/**
 * Os P0 abertos herdados — o §2 exige "zero defeito conhecido P0/P1 no escopo
 * suportado".
 *
 * `p0OpenAggregated` já vem como lista de strings `"<PRD> <id>"`. A primeira
 * versão deste código presumiu objetos e imprimiu `undefined undefined` — o
 * detalhe do bloqueio saía vazio justamente onde ele mais importa, que é dizer
 * QUAL P0 barra a entrada.
 */
function criterioP0Aberto(prd51) {
  const abertos = prd51.p0OpenAggregated || []
  return abertos.length === 0
    ? met("zero_p0_aberto", "rc-checklist-prd51", "nenhum P0 aberto nos programas agregados")
    : unproven("zero_p0_aberto", "rc-checklist-prd51",
      `${abertos.length} P0 aberto(s): ${abertos.map(String).join("; ")}`)
}

/**
 * Os QUATRO itens que o §2 manda REEXECUTAR — não citar.
 *
 * O texto é explícito: "o Sprint 53.0 apenas reexecuta seus controles negativos
 * e retorna `blocked` se qualquer prova faltar". Reexecutar é diferente de
 * apontar o arquivo de teste: um controle citado envelhece calado quando alguém
 * afrouxa a invariante, e é exatamente o que o PRD53 não quer herdar.
 *
 * Então este bloco EXERCITA cada invariante com a entrada adversarial, aqui,
 * agora. Se alguém enfraquecer qualquer uma delas, o portão vira `failed` na
 * próxima execução — sem depender de alguém lembrar de rodar a suíte.
 */
function controlesDoPrd52() {
  return [controleDoAceite(), controleDoTokenUsage(), controleDaLease()]
}

/**
 * §2: "`acceptanceResolved` derivado de compliance EXECUTADO e fresco, não da
 * mera existência de um verifier".
 *
 * O controle é direto: um aceite COM verifier e SEM compliance executado. Se
 * `acceptanceResolved` vier `true`, o produto está derivando exatamente do que o
 * §2 proíbe — e o estado é `failed`, não `unproven`: não falta prova, sobra
 * contradição.
 */
function controleDoAceite() {
  const id = "acceptance_de_compliance_executado"
  const src = "golden-run.deriveEngineGates"
  const comVerifierSemCompliance = [{ id: "feature-behavior", verifier: "tests/x.test.js" }]
  const g = deriveEngineGates({ acceptance: comVerifierSemCompliance })
  return g.acceptanceResolved === true
    ? failed(id, src, "`acceptanceResolved` ficou true com verifier declarado e ZERO compliance executado — é a derivação que o §2 proíbe. `complianceReport` existe em acceptance-verification.js e não está ligado a este portão.")
    : met(id, src, "aceite com verifier mas sem compliance executado NÃO resolve")
}

/** §2: "token usage `unknown` nunca convertido em zero quando houver budget ativo". */
function controleDoTokenUsage() {
  const id = "token_unknown_nunca_zero"
  const src = "mission-schemas (§25.3)"
  const estimado = percentualDeUso({ usageBasis: "estimated", consumed: 5, limit: 10 })
  const soma = consumoCumulativo([
    { subject: "mission_budget", usageBasis: "measured", consumed: 5 },
    { subject: "mission_budget", usageBasis: "unknown" },
  ])
  const ok = estimado === null && soma.basis === "lower_bound" && soma.unknownObservations === 1
  return ok
    ? met(id, src, "estimativa não vira percentual e `unknown` na soma devolve `lower_bound` — invariante provada aqui, mas sem consumidor no produto (o motor é do PRD54)")
    : failed(id, src, `invariante enfraquecida: percentual de estimado=${estimado}, basis=${soma.basis}`)
}

/** §2: "autorização de escrita representada por lease vinculada ao plano e ao escopo". */
function controleDaLease() {
  const id = "lease_vinculada_nao_booleano"
  const src = "mission-schemas (§25.1)"
  const lease = { planHash: "p1", scopeHash: "s1", policyHash: "pol1", worktreeId: "w1", expiresAt: "2099-01-01T00:00:00Z" }
  const outroPlano = { ...lease, planHash: "p2" }
  const foraDoEscopo = acaoCobertaPelaLease({ paths: ["a"], tools: [], commands: [], externalEffects: [] }, { paths: ["b"] })
  const v = leaseAindaVale(lease, outroPlano, Date.parse("2026-01-01T00:00:00Z"))
  const ok = foraDoEscopo === false && v.ok === false && String(v.reason).startsWith("fronteira_mudou")
  return ok
    ? met(id, src, "path fora da lista não é coberto e plano diferente invalida a lease — invariante provada aqui, sem consumidor no produto (o motor é do PRD54)")
    : failed(id, src, `invariante enfraquecida: cobertura=${foraDoEscopo}, retomada=${JSON.stringify(v)}`)
}

/** Artefato exigido que não existe em disco é `unproven`, com o caminho conferido. */
function criteriosDeArtefato(repoRoot) {
  return ARTEFATOS_DO_EVIDENCE_PACK.map((a) => (existsSync(join(repoRoot, a.path))
    ? met(a.id, "disco", `${a.path} presente`)
    : unproven(a.id, "disco", `ausente: ${a.path} — ${a.o_que}`)))
}

/**
 * O portão. `entered` só é verdadeiro com TODOS os critérios em `met`.
 *
 * Não há "quase entrou", nem percentual de prontidão: o §2 fala em entrar ou
 * retornar `blocked`, e um número intermediário só serviria para alguém arredondar
 * para cima.
 */
export function prd53EntryGate({ repoRoot = process.cwd(), commit = null, medicoes = null } = {}) {
  const readiness = prd52Readiness(undefined, { repoRoot, commit, medicoes })
  const criterios = [
    ...criteriosDoPrd52(readiness),
    criterioP0Aberto(prd51Readiness()),
    ...criteriosExternos({
      matriz: construirMatriz({ cwd: repoRoot }),
      hooks: statusDosHooksDoCodex(),
      plano: planoDeCertificacao(),
    }),
    ...controlesDoPrd52(),
    ...criteriosDeArtefato(repoRoot),
  ]
  const faltando = criterios.filter((c) => c.state !== "met")
  return {
    schemaVersion: PRD53_ENTRY_GATE_SCHEMA,
    entered: faltando.length === 0,
    status: faltando.length === 0 ? "open" : "blocked",
    criteria: criterios,
    missing: faltando,
    // O que fecha cada pendência, já separado por natureza: o que se resolve com
    // código aqui e o que exige o mundo lá fora. Sem essa divisão, uma lista de
    // bloqueios vira lista de tarefas, e alguém tenta "consertar" o que não é
    // consertável daqui.
    externalPending: PRD52_EXTERNAL_PENDING.map((e) => ({ id: e.id, blockedBy: e.blockedBy })),
    note: faltando.length === 0
      ? "critérios de entrada do §2 comprovados: o PRD53 pode começar"
      : "PRD53 BLOQUEADO na entrada (§2) — o programa não começa antes de o PRD52 estar certificado",
  }
}
