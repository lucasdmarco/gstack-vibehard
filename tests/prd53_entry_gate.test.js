/**
 * PRD53 Sprint 53.0 — o portão de ENTRADA.
 *
 * O que estes testes defendem é a única propriedade que importa num portão: ele
 * precisa ser capaz de dizer NÃO, e precisa dizer POR QUÊ. Um gate que só foi
 * exercitado no caminho feliz é indistinguível de um `return true`, e o PRD53
 * inteiro depende deste `blocked` funcionar — é o que impede um programa de
 * começar sobre evidência que não existe.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const G = () => imp("src/dream/prd53-entry-gate.js")

/** Medições em que TUDO o que o PRD52 controla está verde. */
const MEDICOES_VERDES = Object.freeze({
  scoreboard: { REAL: 24, PARTIAL: 1, PLACEBO: 0, ROADMAP: 0, RISK: 0 },
  reconciliation: { consistent: 24 },
  reconciliationInvalid: 0,
  supportMatrix: { total: 12, proven: 12, counts: { pass: 12, fail: 0, not_run: 0 } },
  codexHooks: { byState: { trust_entry_present: 6 }, enforcementObserved: true },
  boundaryEnforced: true,
})

test("o portão BLOQUEIA hoje, e nomeia cada critério que falta", async () => {
  const { prd53EntryGate } = await G()
  const g = prd53EntryGate({ repoRoot, commit: "abc1234" })
  assert.equal(g.entered, false, "o PRD53 não pode começar antes de o PRD52 estar certificado")
  assert.equal(g.status, "blocked")
  assert.ok(g.missing.length > 0)
  for (const m of g.missing) {
    assert.ok(m.detail && m.detail.length > 20, `'${m.id}' bloqueia sem dizer o que falta`)
    assert.ok(m.source, `'${m.id}' bloqueia sem dizer de onde veio a medição`)
  }
})

test("o detalhe do P0 aberto NOMEIA os P0 — não sai vazio", async () => {
  const { prd53EntryGate } = await G()
  const g = prd53EntryGate({ repoRoot, commit: "abc1234" })
  const p0 = g.criteria.find((c) => c.id === "zero_p0_aberto")
  if (p0.state === "met") return
  assert.doesNotMatch(p0.detail, /undefined/,
    "o detalhe do bloqueio saía `undefined undefined` — vazio exatamente onde mais importa")
  assert.match(p0.detail, /PRD\d+/, "o P0 que barra a entrada precisa aparecer com o programa dono")
})

test("os critérios que o PRD52 CONTROLA já estão `met` — o bloqueio não é do trabalho feito aqui", async () => {
  const { prd53EntryGate } = await G()
  const g = prd53EntryGate({ repoRoot, commit: "abc1234" })
  const porId = Object.fromEntries(g.criteria.map((c) => [c.id, c]))
  for (const id of ["prd52_ready", "claims_coerentes", "sem_claim_nao_provada"]) {
    assert.equal(porId[id].state, "met", `'${id}' deveria estar provado: ${porId[id].detail}`)
  }
})

test("nenhum critério nasce `met` por omissão — o default é `unproven`", async () => {
  const { prd53EntryGate, ESTADOS_DO_CRITERIO } = await G()
  const g = prd53EntryGate({ repoRoot, commit: "abc1234" })
  for (const c of g.criteria) {
    assert.ok(ESTADOS_DO_CRITERIO.includes(c.state), `estado fora do vocabulário: ${c.state}`)
  }
  // Os artefatos passaram a existir no S53.0.1; o que segue valendo é a regra:
  // o estado vem da CONFERÊNCIA em disco, nunca de presunção.
  const artefatos = g.criteria.filter((c) => c.source === "disco")
  assert.ok(artefatos.length > 0)
  for (const a of artefatos) {
    assert.equal(a.state === "met", a.detail.includes("presente"),
      `'${a.id}': o estado tem de refletir a conferência em disco`)
  }
})

test("CONTROLE NEGATIVO: medições verdes NÃO abrem o portão — o externo continua faltando", async () => {
  const { prd53EntryGate } = await G()
  const g = prd53EntryGate({ repoRoot, commit: "abc1234", medicoes: MEDICOES_VERDES })
  assert.equal(g.entered, false,
    "injetar medição verde não produz a evidência externa que o §2 exige")
  // Com os artefatos já gravados, o que segura são os bloqueios EXTERNOS —
  // medições verdes injetadas não os alcançam, porque eles não são medição.
  const ids = g.missing.map((m) => m.id)
  assert.ok(ids.includes("clean_machine_certificado") || ids.includes("zero_p0_aberto"),
    "evidência externa não se produz injetando número")
})

test("CONTROLE NEGATIVO: placar com claim não provada barra a entrada", async () => {
  const { prd53EntryGate } = await G()
  const g = prd53EntryGate({
    repoRoot, commit: "abc1234",
    medicoes: { ...MEDICOES_VERDES, scoreboard: { REAL: 23, NOT_PROVED: 1 } },
  })
  const c = g.criteria.find((x) => x.id === "sem_claim_nao_provada")
  assert.equal(c.state, "unproven")
  assert.match(c.detail, /NOT_PROVED/)
})

test("CONTROLE NEGATIVO: reconciliação inválida barra a entrada", async () => {
  const { prd53EntryGate } = await G()
  const g = prd53EntryGate({
    repoRoot, commit: "abc1234",
    medicoes: { ...MEDICOES_VERDES, reconciliationInvalid: 2 },
  })
  assert.equal(g.criteria.find((x) => x.id === "claims_coerentes").state, "unproven")
})

test("as pendências externas saem separadas por natureza — não viram lista de tarefas", async () => {
  const { prd53EntryGate } = await G()
  const g = prd53EntryGate({ repoRoot, commit: "abc1234" })
  assert.ok(g.externalPending.length > 0)
  for (const e of g.externalPending) {
    assert.ok(e.blockedBy.startsWith("external_"),
      `'${e.id}' está listado como externo mas o bloqueador não é externo: ${e.blockedBy}`)
  }
})

/**
 * A versão anterior deste teste afirmava que os artefatos NÃO existiam no repo —
 * uma procuração para "o portão não os cria". A procuração venceu no instante em
 * que os artefatos passaram a existir de verdade (S53.0.1), e o teste virou
 * vermelho sem que a propriedade tivesse mudado.
 *
 * Agora ele mede a propriedade direto: roda o portão contra uma raiz VAZIA e
 * exige que continue vazia. Medir não pode fabricar a evidência que se mede.
 */
test("o portão é READ-ONLY: rodar contra raiz vazia não cria artefato nenhum", async () => {
  const { prd53EntryGate, ARTEFATOS_DO_EVIDENCE_PACK } = await G()
  const { existsSync } = await import("node:fs")
  const { mkdtemp } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { cleanupTmp } = await imp("tests/helpers/tmp.js")

  const vazio = await mkdtemp(path.join(tmpdir(), "gstack-gate-ro-"))
  try {
    const g = prd53EntryGate({ repoRoot: vazio, commit: "abc1234" })
    assert.equal(g.entered, false, "raiz vazia jamais entra")
    for (const a of ARTEFATOS_DO_EVIDENCE_PACK) {
      assert.equal(existsSync(path.join(vazio, a.path)), false,
        `o portão CRIOU ${a.path} — medir não pode fabricar a evidência que se está medindo`)
    }
  } finally { cleanupTmp(vazio) }
})
