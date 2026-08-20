/**
 * Compliance EXECUTADO por aceite (PRD53 §2, entregue no PRD52 S52.J).
 *
 * O `complianceReport` existe desde o PRD47 S47.5 e sabe decidir direito: um
 * aceite só é `compliant` com verifier real, diff tocando os arquivos relevantes
 * e RESULTADO DE TESTE correspondente. O que faltava era alguém produzir esse
 * resultado — o `deriveEngineGates` derivava `acceptanceResolved` de
 * `Boolean(a.verifier)`, ou seja, da mera existência do verifier, exatamente o
 * que o §2 do PRD53 proíbe. `complianceReport` tinha ZERO consumidores.
 *
 * Este módulo produz o `testResults` que faltava, e produz do único jeito
 * honesto: EXECUÇÃO.
 *
 *   `gate`     — o pipeline JÁ roda os gates. O resultado sai do relatório real
 *                do `verify` (steps por id), nunca do fato de o aceite citar um
 *                gate. Sem relatório, o aceite fica sem resultado.
 *   `command`  — roda o `ref` no diretório do projeto; exit 0 é o veredito.
 *   demais     — sem runner, sem resultado. `undefined` vira `unverified` no
 *                `checkCompliance`, e é assim que tem de ser: método que ninguém
 *                executa não sustenta entrega.
 *
 * A assimetria é deliberada. Um aceite sem resultado NUNCA é `compliant`; ele
 * apenas não bloqueia por motivo errado — o motivo fica escrito (`unverified`,
 * com razão) em vez de virar um verde por omissão.
 */

import { execFileSync } from "node:child_process"

export const ACCEPTANCE_RUNNER_SCHEMA = "gstack.acceptance-runner.v1"

/**
 * De qual STEP do verify cada gate declarado depende.
 *
 * O `ref` do aceite é prosa de brief (`verify --profile scaffold`, `qg
 * --strict`, `lint`); o step do verify tem id próprio. A tabela liga os dois
 * EXPLICITAMENTE, porque casar por substring acertaria hoje e erraria calado no
 * dia em que um id novo contivesse o outro.
 */
export const STEP_DO_GATE = Object.freeze({
  "lint": ["lint"],
  // `--strict` cobre os DOIS níveis: aprovar por um só seria dizer "strict"
  // sobre metade da checagem. Os ids vieram de medição do `runVerify` real,
  // não de suposição — a primeira versão deste mapa dizia `qg`, id que não
  // existe, e o aceite ficava eternamente `unverified` sem ninguém saber por quê.
  "qg --strict": ["qg-l1", "qg-l2"],
  "verify --profile scaffold": VERIFY_INTEIRO(),
})

/** O veredito é o do verify INTEIRO, não o de um step. */
function VERIFY_INTEIRO() { return "*" }
const GATE_DO_VERIFY_INTEIRO = "*"

/** Status de step que contam como aprovação REAL — `not_applicable` não é um deles. */
const STATUS_APROVADO = Object.freeze(["ok", "passed", "ready"])

const stepPorId = (report, id) => (report.steps || []).find((s) => s.id === id)

/**
 * Resultado de um aceite `gate`, a partir do relatório REAL do verify.
 *
 * `undefined` quando o verify não rodou ou quando o step não existe: sem
 * execução não há resultado, e inventar `true` aqui seria repor o defeito que
 * este módulo veio remover.
 */
function resultadoDeGate(ref, verifyReport) {
  if (!verifyReport) return undefined
  const alvo = STEP_DO_GATE[ref]
  if (!alvo) return undefined
  if (alvo === GATE_DO_VERIFY_INTEIRO) return verifyReport.status !== "blocked"

  const steps = alvo.map((id) => stepPorId(verifyReport, id)).filter(Boolean)
  // Step ausente ou `not_applicable` NÃO é aprovação: o gate não rodou ali,
  // então o aceite que dependia dele continua sem resultado. Traduzir "não se
  // aplica" em "passou" seria o mesmo defeito, com outra roupa.
  if (steps.length !== alvo.length) return undefined
  if (steps.some((s) => s.status === "not_applicable")) return undefined
  return steps.every((s) => STATUS_APROVADO.includes(s.status))
}

/** Resultado de um aceite `command`: roda o `ref` de verdade e lê o exit code. */
function resultadoDeComando(ref, { projectDir, exec }) {
  const rodar = exec || ((cmd, args, opts) => execFileSync(cmd, args, opts))
  const [bin, ...args] = String(ref).trim().split(/\s+/)
  if (!bin) return undefined
  try {
    rodar(bin, args, { cwd: projectDir, stdio: "pipe", encoding: "utf-8", timeout: 120000 })
    return true
  } catch { return false }
}

const RUNNERS = Object.freeze({
  gate: (verifier, ctx) => resultadoDeGate(verifier.ref, ctx.verifyReport),
  command: (verifier, ctx) => resultadoDeComando(verifier.ref, ctx),
})

/**
 * Executa os verificadores e devolve o mapa `id -> true|false`.
 *
 * Aceites sem verifier, pendentes ou de método sem runner ficam FORA do mapa —
 * ausência é a resposta honesta, e o `checkCompliance` a traduz em `unverified`
 * com a razão. Preencher com `false` diria "reprovou", que é outra afirmação.
 */
/** Aceite que TEM verificador executável — o resto nem chega ao runner. */
const executavel = (a) => Boolean(a && !a.pending_verifier && a.verifier && RUNNERS[a.verifier.kind])

export function executarVerificadores({ acceptances = [], verifyReport = null, projectDir = process.cwd(), exec = null } = {}) {
  const ctx = { verifyReport, projectDir, exec }
  const resultados = {}
  for (const a of acceptances.filter(executavel)) {
    const r = RUNNERS[a.verifier.kind](a.verifier, ctx)
    if (r !== undefined) resultados[a.id] = r
  }
  return resultados
}

/** Os métodos que este runner sabe executar. O resto é declarado, não escondido. */
export const METODOS_EXECUTAVEIS = Object.freeze(Object.keys(RUNNERS))

/** Aceites cujo método NÃO tem runner — a lista sai nomeada para quem lê a evidência. */
export function semRunner(acceptances = []) {
  return acceptances
    .filter((a) => a && !a.pending_verifier && a.verifier)
    .filter((a) => !RUNNERS[a.verifier.kind])
    .map((a) => ({ id: a.id, kind: a.verifier.kind }))
}
