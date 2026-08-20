import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

/**
 * PRD52 Sprint 52.A — os schemas do §25 e do §26.
 *
 * São FUNDAÇÃO: validadores puros, sem consumidor. O que estes testes protegem
 * não é a forma dos campos — é a propriedade que faz a forma valer a pena:
 * **nada é inferido**. Campo ausente não vira default, valor fora do vocabulário
 * não passa com aviso, e estado desconhecido tem nome próprio em vez de virar o
 * valor mais conveniente.
 *
 * É a mesma disciplina do inventário i18n e dos checklists de RC, aplicada antes
 * de existir consumidor — porque depois de existir, afrouxar fica barato.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const S = () => imp("src/meta/prd52-schemas.js")
const M = () => imp("src/meta/mission-schemas.js")
const C = () => imp("src/meta/claim-id.js")

// ── claimId canônico ───────────────────────────────────────────────────────

test("claimId compõe e volta ao par de origem", async () => {
  const { claimId, parseClaimId } = await C()
  assert.equal(claimId("dod", "DOD.7"), "dod:DOD.7")
  assert.deepEqual(parseClaimId("dod:DOD.7"), { source: "dod", localId: "DOD.7" })
})

/**
 * O id local é preservado VERBATIM. Normalizar faria dois ids diferentes
 * colidirem, e colisão silenciosa entre claims é pior que um id feio.
 */
test("o id local NÃO é normalizado", async () => {
  const { claimId } = await C()
  assert.equal(claimId("rc_checklist", "P0.CODEX-HOOKS"), "rc_checklist:P0.CODEX-HOOKS")
  assert.notEqual(claimId("rc_checklist", "P0.CODEX-HOOKS"), "rc_checklist:p0-codex-hooks")
})

test("NEGATIVO: fonte fora do vocabulário é ERRO, não projeção nova", async () => {
  const { claimId, parseClaimId } = await C()
  assert.throws(() => claimId("inventada", "x"), /vocabulário é fechado/)
  assert.equal(parseClaimId("inventada:x"), null)
})

test("NEGATIVO: id local vazio ou com separador é recusado", async () => {
  const { claimId } = await C()
  assert.throws(() => claimId("dod", ""), /vazio/)
  assert.throws(() => claimId("dod", "a:b"), /não pode conter/)
})

test("NEGATIVO: strings malformadas não passam por id canônico", async () => {
  const { ehClaimIdCanonico } = await C()
  for (const ruim of ["", "dod", "dod:", ":x", "a:b:c", null, 42]) {
    assert.equal(ehClaimIdCanonico(ruim), false, `${JSON.stringify(ruim)} não é id canônico`)
  }
})

// ── §26.1 Reconciliação ────────────────────────────────────────────────────

const RECONCILIACAO_OK = {
  claimId: "dod:DOD.7",
  sourceCommit: "87a67a7",
  requiredEvidenceRefs: ["tests/x.test.js"],
  observedEvidenceRefs: ["tests/x.test.js"],
  ledgerStatus: "satisfied", proofStatus: "pass",
  blockerStatus: "none", rcStatus: "green",
  consistencyVerdict: "consistent",
  checkedAt: "2026-08-18",
}

test("POSITIVO: reconciliação completa e coerente passa", async () => {
  const { problemasDaReconciliacao } = await S()
  assert.deepEqual(problemasDaReconciliacao(RECONCILIACAO_OK), [])
})

test("NEGATIVO: cada campo ausente é acusado, e TODOS de uma vez", async () => {
  const { problemasDaReconciliacao, CLAIM_RECONCILIATION_FIELDS } = await S()
  const p = problemasDaReconciliacao({})
  for (const f of CLAIM_RECONCILIATION_FIELDS) {
    assert.ok(p.some((x) => x.includes(f)), `${f} precisa aparecer`)
  }
})

/**
 * A REGRA CENTRAL do §26.1: evidência ausente mantém a claim não provada.
 * Declarar `consistent` sem ter observado o exigido é a mentira exata que a
 * reconciliação existe para impedir.
 */
test("NEGATIVO: `consistent` com evidência ausente é recusado, nomeando o que falta", async () => {
  const { problemasDaReconciliacao } = await S()
  const p = problemasDaReconciliacao({
    ...RECONCILIACAO_OK,
    requiredEvidenceRefs: ["a", "b"], observedEvidenceRefs: ["a"],
  })
  assert.ok(p.some((x) => x.includes("evidência ausente") && x.includes("b")))
})

test("NEGATIVO: `not_proved` com toda a evidência observada contradiz o dado", async () => {
  const { problemasDaReconciliacao } = await S()
  const p = problemasDaReconciliacao({ ...RECONCILIACAO_OK, consistencyVerdict: "not_proved" })
  assert.ok(p.some((x) => x.includes("contradiz o dado")))
})

/**
 * `inconclusive:claim_conflict` é estado de PRIMEIRA CLASSE. Fontes que se
 * contradizem sem adjudicação são um problema diferente de evidência que
 * contradiz a claim — e o §26.1 proíbe resolver por maioria ou pelo estado mais
 * favorável, o que exige poder dizer "conflito" em vez de escolher um lado.
 */
test("conflito tem veredito PRÓPRIO, e não é `fail` disfarçado", async () => {
  const { CONSISTENCY_VERDICTS, problemasDaReconciliacao } = await S()
  assert.ok(CONSISTENCY_VERDICTS.includes("inconclusive:claim_conflict"))
  assert.deepEqual(
    problemasDaReconciliacao({ ...RECONCILIACAO_OK, consistencyVerdict: "inconclusive:claim_conflict" }),
    [], "conflito é registrável — a reconciliação não força escolher um lado")
})

test("NEGATIVO: veredito ou commit fora de forma são recusados", async () => {
  const { problemasDaReconciliacao } = await S()
  assert.ok(problemasDaReconciliacao({ ...RECONCILIACAO_OK, consistencyVerdict: "ok" })
    .some((x) => x.includes("fora do vocabulário")))
  assert.ok(problemasDaReconciliacao({ ...RECONCILIACAO_OK, sourceCommit: "HEAD" })
    .some((x) => x.includes("sem commit")))
  assert.ok(problemasDaReconciliacao({ ...RECONCILIACAO_OK, claimId: "DOD.7" })
    .some((x) => x.includes("forma canônica")))
})

// ── §26.2 Readiness com validade ───────────────────────────────────────────

const AGORA = Date.parse("2026-08-18T00:00:00Z")
const OBS = {
  capabilityId: "headroom", status: "callable",
  generatedAt: "2026-08-17T23:30:00Z", staleAfterSeconds: 3600,
  sourceCommit: "abc1234", observedHead: "abc1234",
  probeCommandRef: "cmd", probeResultRef: "res",
}

test("POSITIVO: observação dentro da janela e no mesmo HEAD é consumível", async () => {
  const { estadoConsumivel } = await S()
  assert.equal(estadoConsumivel(OBS, AGORA), "callable")
})

/**
 * As TRÊS portas do §26.2, cada uma sozinha. Um arquivo antigo no workspace NÃO
 * representa o estado atual por existir — e é literalmente o caso de
 * `.gstack/tool-readiness.json` neste repositório.
 */
test("NEGATIVO: prazo expirado derruba para `stale`", async () => {
  const { estadoConsumivel } = await S()
  assert.equal(estadoConsumivel({ ...OBS, generatedAt: "2026-07-16T21:32:22Z" }, AGORA), "stale")
})

test("NEGATIVO: HEAD diferente derruba para `stale`", async () => {
  const { estadoConsumivel } = await S()
  assert.equal(estadoConsumivel({ ...OBS, observedHead: "outro99" }, AGORA), "stale")
})

test("NEGATIVO: sem prova do comando, o estado é `unknown`", async () => {
  const { estadoConsumivel } = await S()
  assert.equal(estadoConsumivel({ ...OBS, probeResultRef: null }, AGORA), "unknown")
})

test("NEGATIVO: janela ausente ou não positiva é `unknown`, nunca `callable`", async () => {
  const { estadoConsumivel } = await S()
  for (const j of [undefined, 0, -1, "abc"]) {
    assert.equal(estadoConsumivel({ ...OBS, staleAfterSeconds: j }, AGORA), "unknown", `janela ${j}`)
  }
})

test("`routed` cai por cache histórico do mesmo jeito que `callable`", async () => {
  const { estadoConsumivel } = await S()
  assert.equal(estadoConsumivel({ ...OBS, status: "routed" }, AGORA), "routed")
  assert.equal(estadoConsumivel({ ...OBS, status: "routed", generatedAt: "2020-01-01T00:00:00Z" }, AGORA), "stale")
})

// ── §26.3 Matriz OS × Node ─────────────────────────────────────────────────

test("célula nova nasce `not_run`, com os recibos vazios", async () => {
  const { celulaNaoExecutada, problemasDaCelula } = await S()
  const c = celulaNaoExecutada({ os: "linux", arch: "x64", nodeVersion: "22" })
  assert.equal(c.verdict, "not_run")
  assert.equal(c.installReceiptRef, null)
  assert.deepEqual(problemasDaCelula(c), [], "não executada é um estado VÁLIDO, não um erro")
})

/**
 * Verde precisa de recibo. Uma célula `pass` sem recibo de instalação, runtime e
 * uninstall afirma três coisas e prova nenhuma.
 */
test("NEGATIVO: `pass` sem recibo é recusado, um recibo por vez", async () => {
  const { problemasDaCelula } = await S()
  const base = {
    os: "linux", arch: "x64", nodeVersion: "22", packageHash: "h",
    installReceiptRef: "i", runtimeReceiptRef: "r", uninstallReceiptRef: "u", verdict: "pass",
  }
  assert.deepEqual(problemasDaCelula(base), [])
  for (const campo of ["packageHash", "installReceiptRef", "runtimeReceiptRef", "uninstallReceiptRef"]) {
    const p = problemasDaCelula({ ...base, [campo]: null })
    assert.ok(p.some((x) => x.includes(campo)), `${campo} ausente precisa reprovar o verde`)
  }
})

/**
 * Decisão humana REDUZ a faixa declarada — e é legítimo. O que ela não faz é
 * transformar célula falha ou não executada em verde.
 */
test("a matriz pública só contém células PROVADAS", async () => {
  const { matrizPublica, celulaNaoExecutada } = await S()
  const provada = {
    os: "linux", arch: "x64", nodeVersion: "22", packageHash: "h",
    installReceiptRef: "i", runtimeReceiptRef: "r", uninstallReceiptRef: "u", verdict: "pass",
  }
  const celulas = [
    provada,
    { ...provada, nodeVersion: "24", verdict: "fail" },
    celulaNaoExecutada({ os: "darwin", arch: "arm64", nodeVersion: "22" }),
  ]
  assert.deepEqual(matrizPublica(celulas).map((c) => c.nodeVersion), ["22"])

  // Faixa reduzida por decisão humana: some da matriz, mas nada vira verde.
  assert.deepEqual(matrizPublica(celulas, { faixaReduzida: ["24"] }), [],
    "reduzir a faixa não promove a célula `fail` do 24")
})

// ── §25 Missão: lease, checkpoint, uso ─────────────────────────────────────

const LEASE = {
  leaseId: "l1", missionId: "m1",
  planHash: "p", scopeHash: "s", policyHash: "pol", worktreeId: "w",
  paths: ["src/"], tools: ["edit"], commands: ["npm test"], network: false,
  budget: 100, externalEffects: [], expiresAt: "2026-08-19T00:00:00Z",
}

test("POSITIVO: ação dentro da fronteira é coberta — sem confirmação por comando", async () => {
  const { acaoCobertaPelaLease } = await M()
  assert.equal(acaoCobertaPelaLease(LEASE, { paths: ["src/"], tools: ["edit"], commands: ["npm test"] }), true)
  assert.equal(acaoCobertaPelaLease(LEASE, {}), true, "ação que não pede nada novo continua coberta")
})

test("NEGATIVO: cada dimensão fora da fronteira derruba a cobertura", async () => {
  const { acaoCobertaPelaLease } = await M()
  assert.equal(acaoCobertaPelaLease(LEASE, { paths: ["/etc"] }), false)
  assert.equal(acaoCobertaPelaLease(LEASE, { tools: ["shell"] }), false)
  assert.equal(acaoCobertaPelaLease(LEASE, { commands: ["rm -rf /"] }), false)
  assert.equal(acaoCobertaPelaLease(LEASE, { network: true }), false, "rede não autorizada é ampliação")
  assert.equal(acaoCobertaPelaLease(LEASE, { externalEffects: ["publish"] }), false)
})

test("NEGATIVO: lease sem listas não aprova nada", async () => {
  const { acaoCobertaPelaLease } = await M()
  assert.equal(acaoCobertaPelaLease({}, { paths: ["src/"] }), false,
    "ausência de lista é NADA aprovado — nunca tudo aprovado")
})

/**
 * A fronteira precisa ser IDÊNTICA na retomada. Plano que mudou, escopo que
 * cresceu ou outra worktree são outra missão — continuar sob a lease antiga
 * usaria uma aprovação dada para outra coisa.
 */
test("NEGATIVO: qualquer hash da fronteira que mude invalida a retomada", async () => {
  const { leaseAindaVale, LEASE_BOUNDARY_FIELDS } = await M()
  const agora = Date.parse("2026-08-18T12:00:00Z")
  assert.equal(leaseAindaVale(LEASE, LEASE, agora).ok, true)

  for (const f of LEASE_BOUNDARY_FIELDS) {
    const r = leaseAindaVale(LEASE, { ...LEASE, [f]: "MUDOU" }, agora)
    assert.equal(r.ok, false, `${f} mudou e a lease continuou valendo`)
    assert.equal(r.reason, `fronteira_mudou:${f}`)
  }
})

test("NEGATIVO: lease expirada ou sem validade não vale", async () => {
  const { leaseAindaVale } = await M()
  const depois = Date.parse("2026-08-20T00:00:00Z")
  assert.equal(leaseAindaVale(LEASE, LEASE, depois).reason, "lease_expirada")
  assert.equal(leaseAindaVale({ ...LEASE, expiresAt: null }, LEASE, depois).reason, "validade_ausente")
})

/**
 * `nextActionRef` é REFERÊNCIA. Reconstruir a próxima ação a partir de prosa
 * faria a retomada depender do transcript — que é exatamente o que fechar,
 * compactar ou trocar de harness destrói.
 */
test("NEGATIVO: checkpoint com próxima ação em prosa é recusado", async () => {
  const { problemasDoCheckpoint } = await M()
  const base = {
    missionId: "m", runId: "r", planHash: "p", worktreeRef: "w",
    completedTaskIds: [], currentTaskId: "t", nextActionRef: "task:t2",
    cumulativeUsage: 0, stopReason: null, providerRef: "x", harnessRef: "y",
    createdAt: "2026-08-18",
  }
  assert.deepEqual(problemasDoCheckpoint(base), [])
  assert.ok(problemasDoCheckpoint({ ...base, nextActionRef: "continuar a implementação do modulo" })
    .some((x) => x.includes("prosa")))
})

test("NEGATIVO: `measured` sem fonte é estimativa com outro nome", async () => {
  const { problemasDaObservacaoDeUso } = await M()
  const base = {
    usageBasis: "measured", subject: "mission_budget",
    consumed: 10, limit: 100, unit: "tokens",
    observedAt: "2026-08-18", sourceRef: "provider-api",
  }
  assert.deepEqual(problemasDaObservacaoDeUso(base), [])
  assert.ok(problemasDaObservacaoDeUso({ ...base, sourceRef: null })
    .some((x) => x.includes("estimativa com outro nome")))
})

/**
 * A regra que impede o número na tela: SÓ `measured` produz percentual.
 * `estimated` e `unknown` devolvem `null`, e `null` é o ponto — um percentual
 * aparente calculado sobre estimativa vira número que o usuário usa para decidir.
 */
test("percentual SÓ existe para `measured`", async () => {
  const { percentualDeUso } = await M()
  assert.equal(percentualDeUso({ usageBasis: "measured", consumed: 9, limit: 10 }), 0.9)
  assert.equal(percentualDeUso({ usageBasis: "estimated", consumed: 9, limit: 10 }), null)
  assert.equal(percentualDeUso({ usageBasis: "unknown", consumed: 9, limit: 10 }), null)
  assert.equal(percentualDeUso({ usageBasis: "measured", consumed: 9, limit: 0 }), null,
    "limite zero não vira percentual infinito")
})

test("o limiar de 90% vale SÓ para o budget da missão", async () => {
  const { atingiuLimiar } = await M()
  const medido = { usageBasis: "measured", consumed: 95, limit: 100 }
  assert.equal(atingiuLimiar({ ...medido, subject: "mission_budget" }), true)
  assert.equal(atingiuLimiar({ ...medido, subject: "provider_quota" }), false,
    "sem sinal oficial, aplicar o limiar à quota inventa o denominador de outra pessoa")
})

/**
 * Budget é CUMULATIVO, e `unknown` não vira zero. Um total que absorve o
 * desconhecido como zero afirma consumo menor que o real — e é assim que um
 * budget estoura sem aviso.
 */
test("consumo cumulativo declara quando é PISO, e não medida", async () => {
  const { consumoCumulativo } = await M()
  const completo = consumoCumulativo([
    { subject: "mission_budget", usageBasis: "measured", consumed: 5 },
    { subject: "mission_budget", usageBasis: "estimated", consumed: 3 },
  ])
  assert.equal(completo.consumed, 8)
  assert.equal(completo.basis, "complete")

  const comDesconhecido = consumoCumulativo([
    { subject: "mission_budget", usageBasis: "measured", consumed: 5 },
    { subject: "mission_budget", usageBasis: "unknown" },
  ])
  assert.equal(comDesconhecido.consumed, 5)
  assert.equal(comDesconhecido.basis, "lower_bound", "com `unknown` o total é piso")
  assert.equal(comDesconhecido.unknownObservations, 1)
})

test("a soma NÃO mistura denominadores", async () => {
  const { consumoCumulativo } = await M()
  const r = consumoCumulativo([
    { subject: "mission_budget", usageBasis: "measured", consumed: 5 },
    { subject: "provider_quota", usageBasis: "measured", consumed: 1000 },
  ])
  assert.equal(r.consumed, 5, "quota da conta e budget da missão são denominadores distintos")
})

// ── A regra do sprint: FUNDAÇÃO sem consumidor ─────────────────────────────

const DIRS_DE_PRODUTO = ["src/commands", "src/dream", "src/release", "src/tools", "src/project-plan", "src/installer"]

function consumidoresDe(modulo) {
  const achados = []
  for (const dir of DIRS_DE_PRODUTO) {
    const abs = path.join(repoRoot, dir)
    for (const f of readdirSync(abs).filter((x) => x.endsWith(".js"))) {
      if (readFileSync(path.join(abs, f), "utf-8").includes(modulo)) achados.push(`${dir}/${f}`)
    }
  }
  return achados.sort()
}

/**
 * O §26 ganhou consumidor no S52.D, e ele é NOMEADO aqui.
 *
 * A lista fixa não é burocracia: quando o schema tinha zero consumidores, o
 * teste garantia que a fundação não fosse acoplada ao primeiro uso. Agora que há
 * uso, ele garante a outra metade — que o consumo continue sendo o que foi
 * decidido, e que um consumidor novo apareça numa revisão em vez de entrar de
 * carona.
 */
test("os consumidores do §26 são exatamente os declarados", async () => {
  assert.deepEqual(consumidoresDe("prd52-schemas.js"),
    ["src/dream/claim-reconciler.js", "src/release/clean-machine-e2e.js",
      "src/release/support-matrix.js", "src/tools/readiness-freshness.js"],
    "consumidor novo do §26 entra por decisão, não por carona")
})

/**
 * O §25 não tem MOTOR, e é isso que a decisão humana registrou: o PRD52 possui
 * os schemas e as invariantes da missão; motor, scheduler e lifecycle são do
 * PRD54. **O PRD52 não implementa loop autônomo.**
 *
 * A primeira versão desta guarda exigia ZERO consumidores — uma procuração para
 * "zero motor". A procuração quebrou no S53.0.1, quando o portão de entrada do
 * PRD53 passou a IMPORTAR as invariantes para reexecutá-las: o §2 do PRD53 manda
 * reexecutar os controles negativos, e reexecutar exige chamar a função.
 *
 * Ceder aqui seria fácil e errado. Então a guarda passou a medir o que realmente
 * importa, em duas partes que se sustentam:
 *
 *   1. a lista de consumidores é FECHADA e nomeada — carona continua impossível;
 *   2. todo consumidor é verificado contra `EXPORTS_DO_PRD54`, a mesma lista que
 *      o gate de fronteira usa. Um consumidor que exporte capacidade do PRD54
 *      reprova aqui e lá.
 *
 * É mais estrito que antes: a versão anterior nunca olhou o que um consumidor
 * faria — só contava que não houvesse nenhum.
 */
const CONSUMIDORES_AUTORIZADOS_DO_25 = Object.freeze([
  // READ-ONLY. Exercita `percentualDeUso`, `consumoCumulativo`,
  // `acaoCobertaPelaLease` e `leaseAindaVale` com entradas adversariais para
  // provar que as invariantes seguem de pé. Não agenda, não executa, não renova
  // e não revoga — nada do que define o motor.
  "src/dream/prd53-entry-gate.js",
])

test("o §25 (missão) segue sem MOTOR: os consumidores são fechados e não exportam capacidade do PRD54", async () => {
  const consumidores = consumidoresDe("mission-schemas.js")
  assert.deepEqual(consumidores, CONSUMIDORES_AUTORIZADOS_DO_25,
    "consumidor do §25 entra por decisão registrada, nunca por carona")

  const { EXPORTS_DO_PRD54, violacoesDaFronteira } = await imp("src/meta/prd52-boundaries.js")
  assert.ok(EXPORTS_DO_PRD54.length > 0)
  assert.deepEqual(violacoesDaFronteira(repoRoot), [],
    "nenhum consumidor do §25 pode exportar motor, scheduler, renovação ou revogação")
})
