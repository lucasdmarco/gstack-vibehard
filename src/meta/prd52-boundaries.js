/**
 * A FRONTEIRA entre PRD52, PRD53 e PRD54 (S52.G) — interface, não implementação.
 *
 * A divisão é decisão humana registrada, e existe porque os três programas
 * tratam da mesma missão autônoma por ângulos que não podem se misturar:
 *
 *   PRD52 — schemas, invariantes e validação FAIL-CLOSED. Descreve o que uma
 *           lease, um checkpoint e uma observação de uso PRECISAM ser.
 *   PRD53 — avaliação adversarial e critérios de promoção. Decide se algo é bom
 *           o bastante para ser promovido.
 *   PRD54 — motor, scheduler, lifecycle, renovação, revogação e recovery.
 *           Executa.
 *
 * **O PRD52 não implementa loop autônomo.** Escrito assim, no imperativo, porque
 * a tentação é concreta: os schemas do §25 estão prontos e escrever o motor em
 * cima deles é a coisa mais natural do mundo. Seria também o modo de o PRD54
 * começar sem ninguém ter decidido que começou — e um motor autônomo nascido de
 * carona é exatamente o que ninguém quer descobrir depois.
 *
 * O que este módulo faz é tornar a fronteira VERIFICÁVEL. Ela não é um acordo
 * escrito num plano que ninguém relê: é uma lista de capacidades proibidas nesta
 * fase, conferida contra o código.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export const PRD52_BOUNDARIES_SCHEMA = "gstack.prd52.boundaries.v1"

/** O que cada programa POSSUI. Uma capacidade pertence a um só. */
export const PROGRAM_BOUNDARIES = Object.freeze({
  prd52: Object.freeze({
    owns: Object.freeze([
      "schemas de ApprovalLease, mission checkpoint e UsageObservation",
      "invariantes e validação fail-closed sobre esses schemas",
      "reconciliação de claims, recibos e validade de readiness",
      "matriz OS × Node com células not_run por ausência de evidência",
    ]),
    schemas: Object.freeze(["src/meta/mission-schemas.js", "src/meta/prd52-schemas.js"]),
  }),
  prd53: Object.freeze({
    owns: Object.freeze(["avaliação adversarial", "critérios de promoção"]),
    consumes: Object.freeze(["src/meta/prd52-schemas.js"]),
  }),
  prd54: Object.freeze({
    owns: Object.freeze([
      "motor de execução da missão", "scheduler", "lifecycle",
      "renovação e revogação de lease", "recovery e retomada",
    ]),
    consumes: Object.freeze(["src/meta/mission-schemas.js"]),
  }),
})

/**
 * As capacidades do PRD54 que NÃO podem existir nesta fase, expressas como nomes
 * de export.
 *
 * A lista é de NOMES, e não de palavras soltas num regex: procurar "scheduler"
 * no texto acusaria um comentário que explica por que não há scheduler — a
 * guarda gritando com a própria documentação. Um export com estes nomes, ao
 * contrário, é capacidade de verdade, porque alguém pode chamá-lo.
 */
export const EXPORTS_DO_PRD54 = Object.freeze([
  "renovarLease", "revogarLease", "renewLease", "revokeLease",
  "agendarMissao", "scheduleMission", "runMissionLoop", "rodarMissao",
  "retomarMissao", "resumeMission", "missionScheduler", "missionEngine",
])

const DIRS_VARRIDOS = Object.freeze(["src/meta", "src/dream", "src/project-plan", "src/commands", "src/skills"])

const arquivosJs = (raiz, dir) => {
  const abs = join(raiz, dir)
  return existsSync(abs) ? readdirSync(abs).filter((f) => f.endsWith(".js")).map((f) => ({ rel: `${dir}/${f}`, abs: join(abs, f) })) : []
}

const exportaNome = (fonte, nome) =>
  new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${nome}\\b`).test(fonte)

/**
 * A fronteira está sendo respeitada?
 *
 * Devolve as violações encontradas. Lista vazia = o PRD52 continua sendo o que
 * foi decidido que ele é.
 */
export function violacoesDaFronteira(repoRoot = process.cwd()) {
  const violacoes = []
  for (const dir of DIRS_VARRIDOS) {
    for (const { rel, abs } of arquivosJs(repoRoot, dir)) {
      const fonte = readFileSync(abs, "utf-8")
      for (const nome of EXPORTS_DO_PRD54) {
        if (exportaNome(fonte, nome)) violacoes.push({ file: rel, capability: nome, owner: "prd54" })
      }
    }
  }
  return violacoes
}

/**
 * O relatório da fronteira, pronto para virar item de checklist.
 *
 * `enforced` diz que a fronteira foi CONFERIDA agora — não que alguém prometeu
 * respeitá-la. É a diferença entre acordo e gate, e o PRD51 gastou um programa
 * inteiro descobrindo que só a segunda forma sobrevive ao tempo.
 */
export function relatorioDaFronteira(repoRoot = process.cwd()) {
  const violacoes = violacoesDaFronteira(repoRoot)
  return {
    schemaVersion: PRD52_BOUNDARIES_SCHEMA,
    boundaries: PROGRAM_BOUNDARIES,
    forbiddenInThisPhase: EXPORTS_DO_PRD54,
    violations: violacoes,
    enforced: violacoes.length === 0,
  }
}
