/**
 * PRD53 S53.0 — os dois artefatos de entrada, e os controles do §2.
 *
 * Um evidence pack e um seed corpus são os documentos que alguém abre meses
 * depois para decidir se pode confiar num programa. Os dois compartilham o mesmo
 * risco: são escritos por quem quer que a resposta seja sim. Os testes abaixo
 * atacam exatamente isso — o pack tem de declarar o que NÃO provou, e o corpus
 * tem de ser incapaz de virar benchmark.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// ── Evidence pack ──────────────────────────────────────────────────────────

test("o pack é DERIVADO e ancorado no commit — nenhum número escrito à mão", async () => {
  const { buildEvidencePack } = await imp("src/dream/prd52-evidence-pack.js")
  const { audit } = await imp("src/dream/auditor.js")
  const pack = buildEvidencePack({ repoRoot, commit: "abc1234" })
  assert.equal(pack.sourceCommit, "abc1234")
  assert.deepEqual(pack.scoreboard, audit({ behavioral: true }).summary,
    "o placar do pack tem de ser o do auditor, medido agora")
  assert.ok(pack.claims.length >= 20)
  for (const c of pack.claims) {
    assert.equal(c.receipt.sourceCommit, "abc1234", `'${c.id}': recibo de outro commit não vale`)
    assert.ok(c.receipt.evidence.every((e) => e.path), "toda evidência do recibo aponta arquivo")
  }
})

test("A METADE QUE IMPORTA: o pack declara o que NÃO provou", async () => {
  const { buildEvidencePack } = await imp("src/dream/prd52-evidence-pack.js")
  const pack = buildEvidencePack({ repoRoot, commit: "abc1234" })
  assert.ok(pack.notMeasured.length >= 5)
  const claims = pack.notMeasured.map((n) => n.claim).join(" | ")
  for (const tema of ["sistemas operacionais", "instalação limpa", "hooks do Codex", "npm", "máquina fria"]) {
    assert.ok(claims.includes(tema), `o pack cala sobre '${tema}' — silêncio pareceria ausência de problema`)
  }
  for (const n of pack.notMeasured) assert.match(n.why, /NÃO medido|NÃO publicado|não é fria|não é limpa/i)
})

test("CONTROLE NEGATIVO: pack sem commit, sem claim ou sem `notMeasured` é inválido", async () => {
  const { buildEvidencePack, problemasDoPack } = await imp("src/dream/prd52-evidence-pack.js")
  const bom = buildEvidencePack({ repoRoot, commit: "abc1234" })
  assert.deepEqual(problemasDoPack(bom), [])
  assert.ok(problemasDoPack({ ...bom, sourceCommit: null }).some((p) => p.includes("sourceCommit")))
  assert.ok(problemasDoPack({ ...bom, claims: [] }).some((p) => p.includes("nenhuma claim")))
  assert.ok(problemasDoPack({ ...bom, notMeasured: [] }).some((p) => p.includes("mente por omissão")))
})

test("o pack gravado em disco está válido e é o do commit atual", async () => {
  const { problemasDoPack, EVIDENCE_PACK_PATH } = await imp("src/dream/prd52-evidence-pack.js")
  const abs = path.join(repoRoot, EVIDENCE_PACK_PATH)
  assert.ok(existsSync(abs), `o portão do PRD53 exige ${EVIDENCE_PACK_PATH}`)
  const pack = JSON.parse(readFileSync(abs, "utf-8"))
  assert.deepEqual(problemasDoPack(pack), [])
  assert.match(pack.sourceCommit, /^[0-9a-f]{7,40}$/)
})

// ── Seed corpus ────────────────────────────────────────────────────────────

test("o corpus tem os três tipos que o §2 exige", async () => {
  const { CASOS, TIPOS_DE_CASO, problemasDoCorpus } = await imp("src/dream/prd53-seed-corpus.js")
  assert.deepEqual(problemasDoCorpus(), [])
  for (const t of TIPOS_DE_CASO) {
    assert.ok(CASOS.some((c) => c.type === t), `falta caso '${t}'`)
  }
})

test("A GUARDA: o corpus é incapaz de virar benchmark — nenhum caso tem métrica de mérito", async () => {
  const { CASOS, construirSeedCorpus } = await imp("src/dream/prd53-seed-corpus.js")
  for (const c of CASOS) {
    for (const proibido of ["score", "expectedAccuracy", "baseline", "gain"]) {
      assert.ok(!(proibido in c), `'${c.id}' tem '${proibido}' — o §2 proíbe percentual de ganho neste corpus`)
    }
  }
  const doc = construirSeedCorpus()
  assert.ok(doc.doesNotAuthorize.some((x) => x.includes("piloto")), "a restrição sai DENTRO do artefato")
  assert.ok(doc.doesNotAuthorize.some((x) => x.includes("percentual")))
  assert.equal(doc.synthetic, true)
})

test("o controle negativo de segurança exige RECUSA, não boa resposta", async () => {
  const { CASOS } = await imp("src/dream/prd53-seed-corpus.js")
  const seg = CASOS.find((c) => c.type === "security_negative_control")
  assert.equal(seg.mustRefuse, true,
    "um corpus de segurança que aceitasse 'respondeu bem' não seria controle negativo de nada")
  assert.match(seg.expectedShape, /recusa/i)
})

test("o corpus gravado em disco é o que o módulo constrói", async () => {
  const { construirSeedCorpus } = await imp("src/dream/prd53-seed-corpus.js")
  const abs = path.join(repoRoot, ".docs", "RESEARCH", "prd53-seed-corpus.json")
  assert.ok(existsSync(abs), "o portão do PRD53 exige o seed corpus em disco")
  assert.deepEqual(JSON.parse(readFileSync(abs, "utf-8")), construirSeedCorpus(),
    "artefato em disco divergente do módulo é duas verdades — a segunda envelhece calada")
})

// ── Os controles do §2, REEXECUTADOS pelo portão ───────────────────────────

test("o portão EXERCITA as invariantes do §2 em vez de citar o arquivo de teste", async () => {
  const { prd53EntryGate } = await imp("src/dream/prd53-entry-gate.js")
  const g = prd53EntryGate({ repoRoot, commit: "abc1234" })
  const porId = Object.fromEntries(g.criteria.map((c) => [c.id, c]))
  assert.equal(porId.token_unknown_nunca_zero.state, "met",
    "estimativa não vira percentual e `unknown` na soma devolve lower_bound")
  assert.equal(porId.lease_vinculada_nao_booleano.state, "met",
    "lease fail-closed por escopo e invalidada por plano diferente")
})

test("O ACHADO: `acceptanceResolved` deriva da EXISTÊNCIA do verifier — e o §2 proíbe", async () => {
  const { deriveEngineGates } = await imp("src/project-plan/golden-run.js")
  const { prd53EntryGate } = await imp("src/dream/prd53-entry-gate.js")
  // O controle vivo: verifier declarado, compliance NUNCA executado.
  const g = deriveEngineGates({ acceptance: [{ id: "lint", verifier: { kind: "gate", ref: "lint" } }] })
  assert.equal(g.acceptanceResolved, true,
    "estado ATUAL do produto — quando isto virar false, o critério do portão fecha sozinho")

  const criterio = prd53EntryGate({ repoRoot, commit: "abc1234" })
    .criteria.find((c) => c.id === "acceptance_de_compliance_executado")
  assert.equal(criterio.state, "failed",
    "`failed` e não `unproven`: não falta prova, sobra contradição entre o código e o §2")
  assert.match(criterio.detail, /complianceReport/,
    "o detalhe aponta o módulo que já existe e não está ligado")
})

test("os artefatos entraram: o portão saiu de 5 para 3 bloqueios de evidência", async () => {
  const { prd53EntryGate } = await imp("src/dream/prd53-entry-gate.js")
  const g = prd53EntryGate({ repoRoot, commit: "abc1234" })
  const porId = Object.fromEntries(g.criteria.map((c) => [c.id, c]))
  assert.equal(porId.evidence_pack.state, "met")
  assert.equal(porId.seed_corpus.state, "met")
  // E o portão SEGUE bloqueado: produzir artefato não substitui evidência externa.
  assert.equal(g.entered, false)
  const externos = g.missing.filter((m) => ["zero_p0_aberto", "pacote_cross_os", "clean_machine_certificado"].includes(m.id))
  assert.equal(externos.length, 3, "os três bloqueios externos continuam de pé")
})
