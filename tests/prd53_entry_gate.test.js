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
  const artefatos = g.criteria.filter((c) => c.source === "disco")
  assert.ok(artefatos.every((a) => a.state === "unproven"),
    "artefato ausente em disco tem de ser `unproven`, nunca presumido")
})

test("CONTROLE NEGATIVO: mesmo com TODAS as medições verdes, artefato ausente segura a entrada", async () => {
  const { prd53EntryGate } = await G()
  const g = prd53EntryGate({ repoRoot, commit: "abc1234", medicoes: MEDICOES_VERDES })
  assert.equal(g.entered, false,
    "o evidence pack e o seed corpus são exigidos pelo §2/§19 e não existem em disco")
  const ids = g.missing.map((m) => m.id)
  assert.ok(ids.includes("evidence_pack"))
  assert.ok(ids.includes("seed_corpus"))
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

test("o portão é READ-ONLY: não declara nada promovido nem escreve artefato", async () => {
  const { prd53EntryGate, ARTEFATOS_DO_EVIDENCE_PACK } = await G()
  const { existsSync } = await import("node:fs")
  prd53EntryGate({ repoRoot, commit: "abc1234" })
  for (const a of ARTEFATOS_DO_EVIDENCE_PACK) {
    assert.equal(existsSync(path.join(repoRoot, a.path)), false,
      `o portão CRIOU ${a.path} — medir não pode fabricar a evidência que se está medindo`)
  }
})
