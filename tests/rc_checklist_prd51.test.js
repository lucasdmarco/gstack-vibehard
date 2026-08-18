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
    // Achado de certificação NÃO se auto-resolve: ou segue `pending`, ou fechou
    // com PROVA apontável. `delivered` sem prova seria exatamente o que este
    // teste existe para impedir.
    if (i.status === "delivered") {
      assert.ok(i.proof, `${i.id} fechou — precisa exibir a prova que o fechou`)
    } else {
      assert.equal(i.status, "pending", `${i.id} é pendência — não se auto-resolve`)
    }
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
/**
 * `ready` AGREGA. Fechar o bloqueante do Node zerou `p0Pending` e `ready` saltou
 * para `true` com DOIS P0 do PRD48 abertos — o mesmo defeito do DOD.7 uma camada
 * acima. O programa que AUDITA os outros não pode se declarar pronto ignorando
 * os P0 que ele mesmo agrega.
 */
test("prd51Readiness: ready:false — P0 aberto em programa AGREGADO conta", async () => {
  const { prd51Readiness } = await imp()
  const r = prd51Readiness()
  assert.equal(r.ready, false, "PRD48 ainda tem dois P0 abertos")
  assert.deepEqual(r.p0Pending, [], "os P0 do PRD51 fecharam — e isso sozinho não basta")
  assert.deepEqual(r.p0OpenAggregated, ["PRD48 P0.CODEX-SECURITY", "PRD48 P0.CODEX-HOOKS"])
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
  assert.equal(item.status, "delivered", "decisão TOMADA e coerência APLICADA")
  assert.equal(item.blocking, false)
  // DECIDIDO em 2026-08-17 — `needsDecision` cai, mas o P0 NÃO fecha: o que
  // bloqueia passou a ser a coerência de `engines`/bootstrap com a decisão.
  assert.equal(item.needsDecision, false)
  assert.equal(item.blockingReason, null, "fechado: não há mais razão de bloqueio a declarar")
  assert.equal(item.fixAuthorized, false, "correção dos 351 arquivos segue NÃO autorizada")
  assert.equal(item.proof, "tests/node_support_contract.test.js")

  // `classification` e preservada VERBATIM: e o registro do estado no momento em
  // que o achado foi levantado, e reescreve-lo apagaria o historico do raciocinio.
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
  assert.equal(c.current_engines, "unchanged", "a opção descreve o estado em que foi escrita")
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
    safe_support: "node22_official_only",
    cross_os: "unproven",
  })

  // O escopo viaja na própria claim: `proved_windows_local`, nunca `proved`.
  // Um SO medido não autoriza afirmação cross-OS.
  assert.notEqual(item.claims.runtime_compatibility, "proved")
  assert.match(item.claims.runtime_compatibility, /windows_local/)
  // DECIDIDO, e a separação continua sendo o ponto: `safe_support` mudou por
  // decisão humana de POLÍTICA, não porque a compatibilidade foi medida. As
  // outras duas claims não se moveram — `suite_compatibility` segue `failing`.
  assert.equal(item.claims.safe_support, "node22_official_only")
  assert.equal(item.claims.suite_compatibility, "failing",
    "decidir suporte não conserta a suíte, e não pode fingir que consertou")
  assert.equal(item.claims.cross_os, "unproven",
    "nenhuma claim cross-OS antes do CI real")

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
/**
 * A matriz REFUTOU a hipótese e a decisão FOI TOMADA — e o P0 continua aberto.
 * Não é teimosia: uma decisão registrada que o produto contradiz é pior que
 * decisão nenhuma, porque parece resolvida. Enquanto `engines` e o bootstrap
 * disserem `>=18`, o contrato público afirma o oposto do que foi decidido.
 */
/**
 * O P0 fechou em DUAS etapas, e a ordem importava: primeiro a decisão, depois a
 * coerência. Fechar na primeira teria registrado uma decisão que o produto
 * contradizia; pular a primeira teria mudado `engines` sem decisão humana.
 */
test("o P0 fechou: decisão TOMADA e coerência APLICADA", async () => {
  const { PRD51_RC_ITEMS, prd51Readiness } = await imp()
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")

  assert.equal(item.status, "delivered")
  assert.equal(item.blocking, false)
  assert.equal(item.blockingReason, null)
  assert.equal(item.needsDecision, false)
  assert.deepEqual(prd51Readiness().p0Pending, [], "nenhum P0 do PRD51 segue aberto")
})

/**
 * A DECISÃO, registrada com quem decidiu e o que ela NÃO afirma. Duas coisas
 * precisam sobreviver a qualquer releitura: 18/20 RODAM (rodar não é ser
 * suportado), e cross-OS não é afirmado.
 */
test("a decisão de suporte registra tiers, base e o que NÃO é afirmado", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  const d = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID").supportDecision

  assert.equal(d.safe_support, "node22_official_only")
  assert.ok(d.decidedOn && d.decidedBy, "decisão sem autor e data é boato")

  const oficial = d.tiers.find((t) => t.tier === "official")
  const melhorEsforco = d.tiers.find((t) => t.tier === "best_effort")
  assert.equal(oficial.range, ">=22")
  assert.match(melhorEsforco.range, /18/)
  assert.equal(melhorEsforco.claim, "runtime_compatible_windows_local",
    "o escopo viaja na claim: um SO medido não autoriza afirmação cross-OS")
  assert.match(melhorEsforco.basis, /rodar não é ser suportado/i)
  assert.match(melhorEsforco.notClaimed, /cross-OS/)
  assert.equal(d.remainingCondition, null, "a condição foi cumprida")
  assert.ok(d.coherenceApplied.engines && d.coherenceApplied.bootstrap && d.coherenceApplied.ci,
    "o que foi feito para fechar precisa estar escrito, e não só o veredito")
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

/**
 * Durante todo o P0 este teste dizia "engines NÃO foi alterado antes da decisão"
 * — mexer nele sozinho seria decidir qual runtime o produto suporta. A decisão
 * existe agora, e a afirmação inverte: `engines` PRECISA refletir o que foi
 * decidido, senão o contrato público contradiz o ledger.
 */
test("o contrato de engines segue a decisão humana — nem antes, nem sem ela", async () => {
  const { readFileSync } = await import("node:fs")
  const { PRD51_RC_ITEMS } = await imp()
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  const d = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID").supportDecision

  assert.equal(pkg.engines.node, ">=22")
  assert.equal(d.tiers.find((t) => t.tier === "official").range, pkg.engines.node,
    "a faixa oficial do ledger e o `engines` são a MESMA afirmação vista de dois lugares")
  assert.ok(d.decidedBy, "e ela tem autor — engines nunca muda por conta própria")
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
  // Programas agregados VAZIOS: o controle é sobre o PRD51, e os P0 do PRD48 têm
  // teste próprio. Misturá-los tornaria este positivo inalcançável por construção.
  const r = prd51Readiness(comP0Fechados(PRD51_RC_ITEMS), tudoOk, [])
  assert.equal(r.programComplete, true, "o caminho para 'concluído' existe — não é inalcançável por construção")
  assert.equal(r.counts.dodOpen, 0)
})

test("CONTROLE: UM P0 aberto basta para impedir programComplete, mesmo com o DoD inteiro satisfeito", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  const tudoOk = PRD51_DOD_ITEMS.map((d) => ({ ...d, status: "satisfied", evidence: d.evidence || "sintético" }))
  const umAberto = [{ prdId: "PRD_X", items: [{ id: "P0.X", tier: "P0", status: "pending" }] }]
  const r = prd51Readiness(comP0Fechados(PRD51_RC_ITEMS), tudoOk, umAberto)
  assert.equal(r.programComplete, false, "o DoD satisfeito não compensa um P0 aberto")
  assert.deepEqual(r.p0OpenAggregated, ["PRD_X P0.X"])
})

test("CONTROLE NEGATIVO: uma única caixa `partial` do DoD já impede programComplete", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  const umaAberta = PRD51_DOD_ITEMS.map((d, idx) => (idx === 0 ? { ...d, status: "partial", missing: "recorte declarado só para este controle negativo" } : { ...d, status: "satisfied", evidence: "sintético" }))
  const r = prd51Readiness(PRD51_RC_ITEMS, umaAberta)
  assert.equal(r.programComplete, false, "`partial` não é `satisfied` — meia prova não fecha caixa")
})

// ── DOD.7: derivado de verdade, e não uma string que se diz derivada ────────

/**
 * O DEFEITO QUE ESTE BLOCO FECHA: `DOD.7` era literalmente
 * `status: "satisfied"` com `evidence: "computado de PRD51_RC_ITEMS e dos
 * checklists agregados"` — uma caixa `derived` escrita à mão, que afirmava ser
 * derivada e não era. Enquanto ela se dizia satisfeita, TRÊS P0 estavam abertos:
 * o `P0.NODE-SUPPORT-GATE-INVALID` do próprio PRD51 e dois do PRD48.
 *
 * O erro não era o número — era a FORMA. Caixa derivada escrita à mão envelhece
 * calada, que é exatamente o defeito já corrigido no DOD.8 e repetido ao lado.
 */
test("DOD.7 não pode ficar `satisfied` com P0 aberto — e hoje há dois", async () => {
  const { PRD51_DOD_ITEMS, estadoDod7 } = await imp()
  const dod7 = PRD51_DOD_ITEMS.find((d) => d.id === "DOD.7")
  assert.equal(dod7.status, "pending")
  assert.equal(dod7.status, estadoDod7().status, "a caixa é o cálculo, não uma cópia dele")
  // Eram TRÊS quando o defeito foi encontrado; o do Node fechou e sobraram dois.
  // O teste segue a lista real, que é o ponto de a caixa ser derivada.
  assert.match(dod7.missing, /2 P0 aberto/)
  for (const esperado of ["P0.CODEX-SECURITY", "P0.CODEX-HOOKS"]) {
    assert.match(dod7.missing, new RegExp(esperado), `${esperado} precisa aparecer NOMEADO`)
  }
})

/**
 * A PORTA DA AGREGAÇÃO, e é ela que justifica o `derived`: um P0 aberto em
 * OUTRO programa precisa reprovar o DOD.7 do PRD51. Sem isso, o PRD51 poderia se
 * declarar sem P0 pendente enquanto um programa que ele audita tem.
 */
test("CONTROLE NEGATIVO: P0 aberto em checklist AGREGADO reprova o DOD.7", async () => {
  const { estadoDod7 } = await imp()
  const prd51Limpo = [{ id: "X", tier: "P0", status: "delivered" }]
  const outroPrograma = [{
    prdId: "PRD_SINTETICO",
    items: [{ id: "P0.SINTETICO", tier: "P0", status: "pending", blocking: true }],
  }]

  const semAgregado = estadoDod7(prd51Limpo, [])
  assert.equal(semAgregado.status, "satisfied", "controle positivo: o caminho para satisfied existe")

  const comAgregado = estadoDod7(prd51Limpo, outroPrograma)
  assert.equal(comAgregado.status, "pending",
    "P0 de outro programa é P0 aberto — o PRD51 audita os outros, não se isenta deles")
  assert.match(comAgregado.missing, /PRD_SINTETICO P0\.SINTETICO/)
})

test("CONTROLE: `partial` também conta como P0 aberto, não só `pending`", async () => {
  const { estadoDod7 } = await imp()
  const r = estadoDod7([{ id: "P0.X", tier: "P0", status: "partial" }], [])
  assert.equal(r.status, "pending", "meia entrega não fecha caixa — é a regra do checklist inteiro")
})

test("CONTROLE: P1 aberto NÃO reprova o DOD.7 — a caixa é sobre P0", async () => {
  const { estadoDod7 } = await imp()
  const r = estadoDod7([{ id: "P1.X", tier: "P1", status: "pending" }], [])
  assert.equal(r.status, "satisfied", "residual P1 tem caixa própria (DOD.8); confundir as duas esconderia ambas")
})

test("CONTROLE: nonGoal COM motivo fecha o P0; sem motivo, não", async () => {
  const { estadoDod7 } = await imp()
  const comMotivo = [{ id: "P0.X", tier: "P0", status: "pending", nonGoal: true, nonGoalReason: "recorte declarado" }]
  const semMotivo = [{ id: "P0.X", tier: "P0", status: "pending", nonGoal: true }]
  assert.equal(estadoDod7(comMotivo, []).status, "satisfied")
  assert.equal(estadoDod7(semMotivo, []).status, "pending",
    "`nonGoal` sem razão escrita é abandono com outro nome")
})

// ── DOD.8: residual aberto precisa de DONO e DESTINO ───────────────────────

/**
 * `residualReport()` responde O QUE está aberto. Sem disposição, "7 residuais
 * abertos" é um número que não obriga ninguém a nada e envelhece igual em
 * qualquer cenário — que é a forma administrativa do mesmo defeito do DOD.7.
 */
test("todo residual aberto tem disposição, dono e milestone", async () => {
  const { residualReport, dispositionOf } = await imp()
  const abertos = residualReport().open.filter((x) => x.tier !== "P0")
  assert.ok(abertos.length > 0, "há residuais abertos — é o estado honesto do RC")

  const vocabulario = new Set(["open", "deferred", "external_evidence_required"])
  for (const r of abertos) {
    const d = dispositionOf(r.prdId, r.id)
    assert.ok(d, `${r.prdId} ${r.id} sem disposição declarada`)
    assert.ok(vocabulario.has(d.disposition), `${r.id}: disposição fora do vocabulário`)
    assert.ok(d.owner, `${r.id} sem dono`)
    assert.ok(d.milestone, `${r.id} sem milestone`)
    assert.ok(d.rationale && d.rationale.length > 40, `${r.id} sem razão escrita`)
    assert.ok(d.recommendation, `${r.id} sem recomendação`)
  }
})

/**
 * `nonGoal` NÃO está no vocabulário de disposição, e a ausência é a regra:
 * converter ausência de correção em non-goal é a forma mais barata de inflar um
 * checklist. Onde a conversão é defensável — `PRD49 P1.5`, cuja exclusão nasceu
 * de achado real do auditor —, ela vem RECOMENDADA e não aplicada.
 */
test("nenhuma disposição converte residual em non-goal por conta própria", async () => {
  const { RESIDUAL_DISPOSITIONS } = await imp()
  for (const d of RESIDUAL_DISPOSITIONS) {
    assert.notEqual(d.disposition, "nonGoal", `${d.id} foi fechado sem decisão humana`)
  }
  const p15 = RESIDUAL_DISPOSITIONS.find((d) => d.prdId === "PRD49" && d.id === "P1.5")
  assert.match(p15.recommendation, /nonGoal/, "a conversão defensável precisa aparecer como RECOMENDAÇÃO")
  assert.equal(p15.disposition, "deferred", "e não como fato consumado")
})

test("DOD.8 segue `pending` com os residuais abertos, e diz que TODOS têm destino", async () => {
  const { PRD51_DOD_ITEMS, estadoDod8 } = await imp()
  const d8 = PRD51_DOD_ITEMS.find((d) => d.id === "DOD.8")
  assert.equal(d8.status, "pending", "residual aberto não vira satisfeito por ter dono")
  assert.equal(d8.undisposed, 0)
  assert.match(d8.missing, /todos com disposição/)
  assert.equal(d8.status, estadoDod8().status, "a caixa é o cálculo, não uma cópia")
})

/**
 * CONTROLE NEGATIVO da própria disposição: residual SEM destino declarado
 * precisa aparecer nomeado, senão o registro não obriga a nada.
 */
test("CONTROLE NEGATIVO: residual sem disposição é acusado", async () => {
  const { estadoDod8 } = await imp()
  const programa = [{ prdId: "PRD_X", items: [{ id: "P1.ORFAO", tier: "P1", status: "partial" }] }]
  const r = estadoDod8([], programa)
  assert.equal(r.status, "pending")
  assert.equal(r.undisposed, 1)
  assert.match(r.missing, /SEM DISPOSIÇÃO/)
  assert.match(r.missing, /que o §9 proíbe/)
})

test("CONTROLE POSITIVO: sem residual aberto, DOD.8 fecha", async () => {
  const { estadoDod8 } = await imp()
  assert.equal(estadoDod8([], []).status, "satisfied", "o caminho para satisfied existe")
})

/**
 * `external_clean_machine_e2e` fica FORA da contagem de residuais. É condição de
 * release, não dívida de programa: somá-la aos P1 faria parecer código faltando
 * o que é ausência de máquina.
 */
test("o E2E de máquina limpa é separado dos residuais, e não é afirmado", async () => {
  const { EXTERNAL_CLEAN_MACHINE_E2E, RESIDUAL_DISPOSITIONS } = await imp()
  assert.equal(EXTERNAL_CLEAN_MACHINE_E2E.disposition, "external_evidence_required")
  assert.ok(EXTERNAL_CLEAN_MACHINE_E2E.owner && EXTERNAL_CLEAN_MACHINE_E2E.milestone)
  assert.match(EXTERNAL_CLEAN_MACHINE_E2E.notClaimed, /nada será declarado/)
  assert.equal(RESIDUAL_DISPOSITIONS.some((d) => d.id === "external_clean_machine_e2e"), false,
    "misturá-lo aos residuais faria parecer dívida técnica o que é ausência de ambiente")
})

// ── DOD.12: recorte DECIDIDO, e não `partial` indefinido ───────────────────

/**
 * `partial` sem prazo é a pior das três respostas: parece trabalho em andamento
 * e não obriga ninguém. Aqui o recorte vira decisão, com destino, dono e — o que
 * mais importa — o que NÃO será entregue, escrito por extenso.
 */
test("DOD.12 declara destino, o que não será entregue e as claims afetadas", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  const d = PRD51_DOD_ITEMS.find((x) => x.id === "DOD.12")
  assert.equal(d.status, "partial")
  assert.equal(d.disposition, "deferred_to_post_rc")
  assert.ok(d.owner && d.milestone)
  assert.match(d.notDelivered, /subcomando inexistente/)
  assert.match(d.notDelivered, /flag documentada/)
  assert.deepEqual(d.rcClaimsAffected, [], "nenhuma claim do RC depende do recorte")
})

/**
 * A PROVA de que nenhuma claim depende do recorte, e não a afirmação dela: o
 * registry é consumido pelo FIREWALL de efeitos por operação, nunca para validar
 * entrada do usuário. Se algum dia alguém o usar para validar entrada, as duas
 * detecções que ficaram de fora passam a importar — e este teste quebra.
 */
test("o registry de operações serve ao firewall, não à validação de entrada", async () => {
  const { readFileSync, readdirSync } = await import("node:fs")
  const consumidores = []
  for (const dir of ["src/commands", "src/cli", "src/meta", "src/skills"]) {
    const abs = path.join(repoRoot, dir)
    for (const f of readdirSync(abs).filter((x) => x.endsWith(".js"))) {
      const src = readFileSync(path.join(abs, f), "utf-8")
      if (/operation-registry/.test(src)) consumidores.push(`${dir}/${f}`)
    }
  }
  assert.ok(consumidores.length > 0, "o registry precisa ter consumidor real")
  for (const c of consumidores) {
    const src = readFileSync(path.join(repoRoot, c), "utf-8")
    assert.equal(/unknown (sub)?command|comando desconhecido/i.test(src), false,
      `${c} usa o registry para validar entrada — aí o recorte do DOD.12 passa a afetar claim`)
  }
})
