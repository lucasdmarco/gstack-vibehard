import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD51 S51.10.1 — checklist canônico do próprio PRD51. Até aqui, o programa de
 * FECHAMENTO era o único sem checklist: `prd status` agregava PRD45-PRD50 e deixava de
 * fora justamente quem audita os outros.
 *
 * O que este arquivo protege não é a contagem — é a honestidade da contagem: prova que
 * existe em disco, DoD que não se satisfaz por omissão, e `ready` que nunca implica
 * `programComplete`.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "dream", "rc-checklist-prd51.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

/**
 * Item de SPRINT registra o que um sprint entregou; item de CERTIFICAÇÃO registra
 * o que a certificação do RC ACHOU e ainda não tem dono. O segundo não tem sprint
 * nem prova — se tivesse prova, não seria pendência.
 *
 * A regra que importa (mesma do PRD48) é a inversa e vale para os dois: nada se
 * declara fechado sem prova em disco, e nada pendente exibe prova.
 */
const ehDeSprint = (i) => i.sprint !== "certificação RC"

test("cada item aponta uma prova que EXISTE em disco (a regra que o S51.3 aprendeu quebrando)", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  for (const i of PRD51_RC_ITEMS) {
    if (i.status === "pending") {
      assert.equal(i.proof, null, `${i.id} está pendente ⇒ não pode exibir prova`)
      continue
    }
    assert.ok(i.proof, `${i.id} declara prova`)
    assert.ok(existsSync(path.join(repoRoot, i.proof)), `prova de ${i.id} existe: ${i.proof}`)
  }
})

test("todo item de SPRINT mapeia sprint + versão + tier (rastreabilidade achado→sprint→release)", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  const tiers = new Set(["P0", "P1", "P2"])
  const deSprint = PRD51_RC_ITEMS.filter(ehDeSprint)
  assert.ok(deSprint.length > 40, "a maioria esmagadora dos itens é de sprint")
  for (const i of deSprint) {
    assert.match(i.sprint, /^S51\./, `${i.id} tem sprint do PRD51`)
    assert.match(i.version, /^5\.\d+\.\d+$/, `${i.id} tem versão`)
    assert.ok(tiers.has(i.tier), `${i.id} tem tier válido`)
    assert.ok(i.title && i.title.length > 10, `${i.id} tem título descritivo`)
  }
})

test("item de CERTIFICAÇÃO carrega o que um achado sem dono precisa carregar", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  const tiers = new Set(["P0", "P1", "P2"])
  const deCertificacao = PRD51_RC_ITEMS.filter((i) => !ehDeSprint(i))
  assert.ok(deCertificacao.length > 0, "a certificação do RC produziu achado registrado")
  for (const i of deCertificacao) {
    assert.ok(tiers.has(i.tier), `${i.id} tem tier válido`)
    assert.ok(i.title && i.title.length > 10, `${i.id} tem título descritivo`)
    assert.ok(i.evidence && i.evidence.length > 50, `${i.id} carrega evidência medida, não impressão`)
    assert.ok(i.impact, `${i.id} declara o impacto`)
    assert.equal(i.status, "pending", `${i.id} é pendência — não se auto-resolve`)
  }
})

test("o DoD cobre as 24 caixas do §9 do prd51.md, cada uma com kind declarado", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  assert.equal(PRD51_DOD_ITEMS.length, 24, "§9 tem 24 caixas")
  const kinds = new Set(["static", "runtime", "derived"])
  for (const d of PRD51_DOD_ITEMS) {
    assert.ok(kinds.has(d.kind), `${d.id} declara kind`)
    assert.ok(d.requirement && d.requirement.length > 10, `${d.id} tem requisito`)
  }
})

test("INVARIANTE: toda caixa não-satisfeita diz O QUE falta — nada pendente em silêncio", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  for (const d of PRD51_DOD_ITEMS.filter((x) => x.status !== "satisfied")) {
    assert.ok(d.missing && d.missing.length > 20, `${d.id} explica a ausência em vez de só marcar pendente`)
  }
})

test("INVARIANTE: toda caixa satisfeita aponta evidência — nunca 'satisfied' por decreto", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  for (const d of PRD51_DOD_ITEMS.filter((x) => x.status === "satisfied")) {
    assert.ok(d.evidence, `${d.id} aponta evidência`)
  }
})

test("evidência estática do DoD existe em disco (uma caixa não pode citar teste inexistente)", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  for (const d of PRD51_DOD_ITEMS.filter((x) => x.evidence && x.evidence.startsWith("tests/"))) {
    assert.ok(existsSync(path.join(repoRoot, d.evidence)), `evidência de ${d.id} existe: ${d.evidence}`)
  }
})

test("nenhuma caixa `runtime` é dada como satisfeita — execução não se presume por existir código", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  const runtimeSatisfeitas = PRD51_DOD_ITEMS.filter((d) => d.kind === "runtime" && d.status === "satisfied")
  assert.deepEqual(runtimeSatisfeitas, [], "suíte fria, proof no HEAD e matriz cross-OS só fecham executando")
})

/**
 * Este teste afirmava `ready:true` — "todo P0 dos sprints está fechado", que
 * continua verdade. O que mudou é que a CERTIFICAÇÃO abriu um P0 que os sprints
 * não tinham: `P0.NODE-SUPPORT-GATE-INVALID`. `ready` responde "não há P0
 * aberto", e agora há um, então `false` é a resposta correta.
 *
 * Não relaxar isto é o ponto: um bloqueante registrado que não derruba `ready`
 * seria decoração.
 */
test("prd51Readiness: ready:false — os P0 dos sprints fecharam, mas a certificação abriu um", async () => {
  const { prd51Readiness } = await imp()
  const r = prd51Readiness()
  assert.equal(r.ready, false, "existe P0 aberto — o bloqueante de suporte do Node")
  assert.deepEqual(r.p0Pending, ["P0.NODE-SUPPORT-GATE-INVALID"],
    "e é SÓ ele: nenhum P0 de sprint regrediu")
  assert.equal(r.programComplete, false, "o §9 ainda tem caixas abertas — ready nunca autoriza 'concluído'")
  assert.ok(r.counts.dodOpen > 0)
  assert.equal(r.counts.dodSatisfied + r.counts.dodOpen, r.counts.dod)
})

/**
 * O bloqueante existe para ser DECIDIDO, não para ser contornado. As proibições
 * são explícitas: não virar baseline, não desabilitar o job, não declarar Node 18
 * suportado. Este teste guarda a forma do registro; a decisão é humana.
 */
test("P0.NODE-SUPPORT-GATE-INVALID está registrado com classificação e opções de decisão", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")
  assert.ok(item, "o achado precisa estar no ledger, não só no relatório")

  assert.equal(item.tier, "P0")
  assert.equal(item.status, "pending")
  assert.equal(item.blocking, true)
  assert.equal(item.needsDecision, true)
  assert.equal(item.fixAuthorized, false, "correção dos 351 arquivos NÃO foi autorizada")
  assert.equal(item.proof, null, "sem prova: é exatamente o que falta")

  assert.deepEqual(item.classification, {
    declared_support: "node >=18",
    phase1b_compatibility: "proved_on_node18",
    repository_suite_on_node18: "failing",
    node18_support_claim: "unproven",
    ci_gate_status: "structurally_invalid",
    cause: "import.meta.dirname em 351 arquivos de teste",
    blocker: "release_support_decision",
  })

  const ids = item.decisionOptions.map((o) => o.id)
  assert.deepEqual(ids, ["C", "A", "B"], "C encabeça: é a recomendada")
  for (const o of item.decisionOptions) {
    assert.ok(o.summary && o.requires, `opção ${o.id} declara o que exige`)
  }

  // Exatamente UMA recomendada, e é a que exige evidência antes de decidir.
  const recomendadas = item.decisionOptions.filter((o) => o.recommended === true)
  assert.deepEqual(recomendadas.map((o) => o.id), ["C"])

  const c = item.decisionOptions.find((o) => o.id === "C")
  // `evidence_required` -> `evidence_partial`: a matriz Windows foi obtida; falta
  // cross-OS. O status acompanha a evidência, e não o contrário.
  assert.equal(c.decision_status, "evidence_partial")
  assert.equal(c.current_engines, "unchanged", "engines segue intocado até a decisão")
  assert.equal(c.node22_status, "recommended_runtime")
  assert.equal(c.node18_20_status, "runtime_compatible_windows_local",
    "18/20 rodam o produto — o que falta é decisão de suporte, não compatibilidade")
  assert.ok(c.obtained && c.requires, "o que já foi provado e o que falta, separados")

  // A continua DISPONÍVEL — rebaixar não é remover.
  assert.equal(item.decisionOptions.find((o) => o.id === "A").recommended, false)
})

/**
 * O erro que produziu a primeira versão deste registro: medi a SUÍTE e
 * recomendei elevar `engines`, que é afirmação sobre o RUNTIME. As três claims
 * existem para que essa confusão não caiba mais no dado.
 */
test("as três claims do bloqueante são registradas SEPARADAMENTE", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")

  assert.deepEqual(item.claims, {
    runtime_compatibility: "proved_windows_local",
    suite_compatibility: "failing",
    safe_support: "undecided",
  })

  // O escopo viaja na própria claim: `proved_windows_local`, nunca `proved`.
  // Um SO medido não autoriza afirmação cross-OS.
  assert.notEqual(item.claims.runtime_compatibility, "proved")
  assert.match(item.claims.runtime_compatibility, /windows_local/)
  assert.equal(item.claims.safe_support, "undecided",
    "medir compatibilidade NÃO decide o contrato de suporte")

  // A evidência precisa carregar os números medidos, não uma impressão.
  for (const numero of ["208", "352", "351", "74"]) {
    assert.ok(item.evidence.includes(numero), `evidência precisa citar ${numero}`)
  }
})

/**
 * A matriz REFUTOU a hipótese que originou o P0 — mas refutar a hipótese não
 * fecha o bloqueante. O que resta não é compatibilidade: é decisão de política
 * (suíte quebrada em 18/20 e runtimes fora de suporte upstream) e cobertura
 * cross-OS. Fechar aqui seria trocar "o produto funciona" por "o suporte está
 * decidido", que são coisas diferentes.
 */
test("a matriz REFUTA a hipótese, mas o P0 permanece ABERTO", async () => {
  const { PRD51_RC_ITEMS, prd51Readiness } = await imp()
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")

  assert.equal(item.status, "pending", "medir compatibilidade não fecha o bloqueante")
  assert.equal(item.blocking, true)
  assert.equal(item.needsDecision, true)
  assert.deepEqual(prd51Readiness().p0Pending, ["P0.NODE-SUPPORT-GATE-INVALID"])
})

test("a evidência da matriz registra as QUATRO versões com escopo e procedência", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  const m = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID").runtimeMatrix

  assert.equal(m.os_coverage, "windows_local", "um SO — nunca anunciar mais do que foi medido")
  assert.match(m.cross_os, /unproven/, "Linux/macOS dependem do workflow, que nunca rodou")
  assert.equal(m.install, "offline", "rede proibida, não apenas evitada")
  assert.match(m.tarballSha256, /^sha256:[0-9a-f]{64}$/)
  assert.match(m.commit, /^[0-9a-f]{40}$/)

  assert.equal(m.versions.length, 4)
  assert.deepEqual(m.versions.map((v) => v.node), ["v18.20.8", "v20.19.5", "v22.21.1", "v24.14.0"])
  assert.ok(m.versions.every((v) => v.verdict === "runtime_compatible"))

  // A degradação em 18/20 é observada, e a leitura estrita continua reprovando —
  // as duas saem juntas, e nenhuma é escondida.
  assert.deepEqual(m.versions.filter((v) => !v.sqlite_available).map((v) => v.backend),
    ["jsonl_fallback", "jsonl_fallback"])
  assert.match(m.readings.strict, /^fail/)
  assert.match(m.readings.declared_degradation, /^pass/)
  assert.match(m.readings.declared_degradation, /CAPACIDADE ausente, nao pela versao/)
})

test("a Fase 1B NÃO é responsabilizada pelo bloqueante do Node", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")
  assert.equal(item.classification.phase1b_compatibility, "proved_on_node18")
  assert.match(item.evidence, /ZERO falhas atribu/i,
    "a separação de culpa é parte do registro: misturar as duas coisas esconderia as duas")
})

test("o contrato de engines NÃO foi alterado antes da decisão", async () => {
  const { readFileSync } = await import("node:fs")
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.match(pkg.engines.node, />=\s*18/,
    "mexer em engines antes da decisão humana seria decidir sozinho qual runtime o produto suporta")
})

// S51.10.4: a versão anterior fixava `DOD.22` como pendência aberta — e quebrou no
// sprint que a FECHOU. Prender um teste a um item específico do DoD garante churn a cada
// caixa resolvida, sem proteger nada a mais. A invariante que importa é estrutural:
// toda pendência carrega o que falta, e nenhuma caixa `runtime` se declara satisfeita.
test("openDoD expõe cada pendência com o que falta (o RC precisa saber, não descobrir)", async () => {
  const { prd51Readiness } = await imp()
  const r = prd51Readiness()
  assert.ok(r.openDoD.length > 0, "enquanto houver caixa aberta, ela precisa aparecer")
  for (const d of r.openDoD) {
    assert.ok(d.missing, `${d.id} carrega o que falta`)
    assert.ok(d.requirement, `${d.id} diz qual exigência ficou em aberto`)
  }
})

/** Fecha sinteticamente todo P0 aberto — usado só pelos controles positivos. */
const comP0Fechados = (itens) => itens.map((i) =>
  (i.tier === "P0" && i.status !== "delivered" ? { ...i, status: "delivered" } : i))

test("CONTROLE NEGATIVO: um P0 que regredir derruba ready E programComplete", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  // Parte da base com os P0 abertos REAIS já fechados, para isolar a regressão
  // que este controle injeta — senão ele mediria o bloqueante do Node, não o S51.2.7.
  const base = comP0Fechados(PRD51_RC_ITEMS)
  const regredido = base.map((i) => (i.id === "S51.2.7" ? { ...i, status: "partial" } : i))
  const r = prd51Readiness(regredido, PRD51_DOD_ITEMS)
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["S51.2.7"])
  assert.equal(r.programComplete, false)
})

test("CONTROLE POSITIVO: com todo o DoD satisfeito E os P0 fechados, programComplete vira true", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  const tudoOk = PRD51_DOD_ITEMS.map((d) => ({ ...d, status: "satisfied", evidence: d.evidence || "sintético" }))
  const r = prd51Readiness(comP0Fechados(PRD51_RC_ITEMS), tudoOk)
  assert.equal(r.programComplete, true, "o caminho para 'concluído' existe — não é inalcançável por construção")
  assert.equal(r.counts.dodOpen, 0)
})

test("CONTROLE: o bloqueante do Node, sozinho, impede programComplete mesmo com o DoD inteiro satisfeito", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  const tudoOk = PRD51_DOD_ITEMS.map((d) => ({ ...d, status: "satisfied", evidence: d.evidence || "sintético" }))
  const r = prd51Readiness(PRD51_RC_ITEMS, tudoOk)
  assert.equal(r.programComplete, false, "um P0 aberto basta — o DoD satisfeito não o compensa")
  assert.deepEqual(r.p0Pending, ["P0.NODE-SUPPORT-GATE-INVALID"])
})

test("CONTROLE NEGATIVO: uma única caixa `partial` do DoD já impede programComplete", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  const umaAberta = PRD51_DOD_ITEMS.map((d, idx) => (idx === 0 ? { ...d, status: "partial", missing: "recorte declarado só para este controle negativo" } : { ...d, status: "satisfied", evidence: "sintético" }))
  const r = prd51Readiness(PRD51_RC_ITEMS, umaAberta)
  assert.equal(r.programComplete, false, "`partial` não é `satisfied` — meia prova não fecha caixa")
})
