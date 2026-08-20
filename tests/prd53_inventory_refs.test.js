/**
 * PRD53 S53.0 (§19) — inventário dos manuais, manifest de referências externas
 * e o runbook das pendências externas.
 *
 * O risco comum aos três é o mesmo, e é sedutor: um artefato que CATALOGA
 * material vira, com o tempo, um artefato que AUTORIZA. Basta alguém ler
 * "mapeado para `golden-run.js`" como permissão para implementar. Por isso o que
 * estes testes mais defendem não é o conteúdo — é o teto: nada aqui promove
 * nada, e a regra viaja dentro do JSON.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const I = () => imp("src/dream/prd53-manual-inventory.js")
const X = () => imp("src/dream/prd53-external-refs.js")
const P = () => imp("src/release/external-pending.js")

const lerArtefato = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), "utf-8"))

// ── Inventário dos manuais ─────────────────────────────────────────────────

test("os dois manuais são inventariados por heading, com hash de arquivo e de seção", async () => {
  const { inventarioDosManuais, problemasDoInventario } = await I()
  const inv = inventarioDosManuais({ repoRoot, commit: "abc1234" })
  assert.deepEqual(problemasDoInventario(inv), [])
  assert.equal(inv.sourceManifest.length, 2)
  for (const m of inv.sourceManifest) {
    assert.equal(m.absent, false, `manual ausente: ${m.path}`)
    assert.match(m.fileHash, /^sha256:/)
    assert.ok(m.sections > 50, `${m.id} com só ${m.sections} seções — o seccionador não pegou o arquivo`)
  }
  for (const s of inv.manuals.flatMap((m) => m.sections)) {
    assert.match(s.bodyHash, /^sha256:/)
    assert.match(s.headingId, /^[a-z-]+#/)
  }
})

test("O TETO: nenhuma seção é promovida, e toda substantiva sai no piso honesto", async () => {
  const { inventarioDosManuais } = await I()
  const inv = inventarioDosManuais({ repoRoot, commit: "abc1234" })
  assert.equal(inv.counts.promoted, 0, "o §19 proíbe promoção por título")
  for (const s of inv.manuals.flatMap((m) => m.sections).filter((x) => x.substantive)) {
    assert.deepEqual(
      { t: s.disposition.treatment, l: s.disposition.lifecycle, c: s.disposition.capabilityState },
      { t: "human_reference", l: "catalogued", c: "missing" },
      `'${s.headingId}' saiu acima do piso — promover exige os oito elementos do §1`)
  }
})

test("os três eixos usam vocabulário FECHADO do §6", async () => {
  const { inventarioDosManuais, TREATMENTS, LIFECYCLES, CAPABILITY_STATES } = await I()
  const inv = inventarioDosManuais({ repoRoot, commit: "abc1234" })
  for (const s of inv.manuals.flatMap((m) => m.sections).filter((x) => x.disposition)) {
    assert.ok(TREATMENTS.includes(s.disposition.treatment))
    assert.ok(LIFECYCLES.includes(s.disposition.lifecycle))
    assert.ok(CAPABILITY_STATES.includes(s.disposition.capabilityState))
  }
})

test("índice, seção sem corpo e conteúdo DUPLICADO não viram prática", async () => {
  const { seccionar, inventariarManual, MOTIVOS_NAO_PRATICA } = await I()
  assert.equal(seccionar("# A\n\ntexto\n\n## B\n\noutro").length, 2)
  const inv = inventariarManual({ id: "projetogstack", path: path.join(".docs", "PLANS", "projetogstack.md") }, { repoRoot })
  const descartadas = inv.sections.filter((s) => !s.substantive)
  assert.ok(descartadas.length > 0)
  for (const d of descartadas) {
    assert.ok(MOTIVOS_NAO_PRATICA.includes(d.notPracticeReason), `motivo fora do vocabulário: ${d.notPracticeReason}`)
    assert.equal(d.disposition, null, "seção descartada não recebe disposição")
  }
})

test("CONTROLE NEGATIVO: seção substantiva SEM disposição reprova o inventário", async () => {
  const { problemasDoInventario, inventarioDosManuais } = await I()
  const inv = inventarioDosManuais({ repoRoot, commit: "abc1234" })
  const adulterado = JSON.parse(JSON.stringify(inv))
  const alvo = adulterado.manuals[0].sections.find((s) => s.substantive)
  alvo.disposition = null
  assert.ok(problemasDoInventario(adulterado).some((p) => p.includes("sem disposition")))
})

test("CONTROLE NEGATIVO: promoção pelo inventário reprova — a guarda do DoD", async () => {
  const { problemasDoInventario, inventarioDosManuais } = await I()
  const inv = inventarioDosManuais({ repoRoot, commit: "abc1234" })
  const adulterado = JSON.parse(JSON.stringify(inv))
  adulterado.counts.promoted = 1
  assert.ok(problemasDoInventario(adulterado).some((p) => p.includes("promoção por título")))
})

test("o mapeamento canônico é CANDIDATO e mostra o termo que o casou", async () => {
  const { inventarioDosManuais } = await I()
  const inv = inventarioDosManuais({ repoRoot, commit: "abc1234" })
  const comCandidato = inv.manuals.flatMap((m) => m.sections).filter((s) => s.canonicalCandidates.length)
  assert.ok(comCandidato.length > 0)
  for (const s of comCandidato.slice(0, 20)) {
    for (const c of s.canonicalCandidates) {
      assert.ok(c.matchedTerms.length > 0, "candidato sem termo casado seria mapeamento por adivinhação")
      assert.ok(c.componentes.length > 0)
    }
  }
  assert.ok(inv.doesNotAuthorize.some((x) => x.includes("CANDIDATO")),
    "a restrição do mapeamento viaja DENTRO do artefato")
})

// ── Manifest de referências externas ───────────────────────────────────────

test("O ACHADO do §19: nenhuma referência externa sustenta implementação hoje", async () => {
  const { manifestDeReferencias, problemasDoManifest } = await X()
  const m = manifestDeReferencias({ repoRoot, commit: "abc1234" })
  assert.deepEqual(problemasDoManifest(m), [])
  assert.ok(m.counts.total >= 10, `esperava as referências do registry, veio ${m.counts.total}`)
  assert.equal(m.counts.sustaining, 0,
    "o registry guarda url/status/role e NÃO guarda commit, licença nem maturidade")
  assert.equal(m.counts.vendoringAllowed, 0, "licença desconhecida nunca autoriza vendoring")
  for (const r of m.references) {
    assert.equal(r.runtimeDependencyForbidden, true, "a proibição viaja com o dado, não só no PRD")
    assert.ok(r.missingFields.includes("commit") || r.commit, "campo faltante tem de sair nomeado")
  }
})

test("CONTROLE NEGATIVO: referência marcada como sustentando SEM os três campos reprova", async () => {
  const { manifestDeReferencias, problemasDoManifest } = await X()
  const m = manifestDeReferencias({ repoRoot, commit: "abc1234" })
  const adulterado = JSON.parse(JSON.stringify(m))
  adulterado.references[0].sustainsImplementation = true
  assert.ok(problemasDoManifest(adulterado).some((p) => p.includes("sem commit/licença/disposition")))
})

test("referência COM os três campos sustenta — a regra não é 'sempre não'", async () => {
  const { projetarReferencia } = await X()
  const completa = projetarReferencia({
    url: "https://x/y", commit: "abc1234", license: "MIT", maturity: "stable",
    status: "active_reference", origin: "externalReferences",
  })
  assert.equal(completa.sustainsImplementation, true)
  assert.deepEqual(completa.missingFields, [])
  assert.equal(completa.vendoringAllowed, false, "sustentar implementação ainda não é autorizar vendoring")
})

// ── Runbook das pendências externas ────────────────────────────────────────

test("o runbook diz o que fazer E como conferir, para cada pendência", async () => {
  const { construirPendenciasExternas, problemasDasPendencias } = await P()
  const d = construirPendenciasExternas({ cwd: repoRoot, commit: "abc1234" })
  assert.deepEqual(problemasDasPendencias(d), [])
  assert.equal(d.pending.length, 3)
  for (const p of d.pending) {
    assert.ok(p.closes, `'${p.id}' não diz qual critério do portão ele destrava`)
    assert.ok(p.verify.includes("node src/index.js"), `'${p.id}' sem comando de conferência`)
  }
  assert.ok(d.cleanMachine.preconditions.length >= 4, "quem prepara a imagem precisa da lista COMPLETA de vestígios")
  assert.deepEqual(d.cleanMachine.steps.map((s) => s.id), ["install", "runtime", "enforcement", "uninstall"])
  assert.equal(d.supportMatrix.pendingCells.length, 12)
})

test("CONTROLE NEGATIVO: pendência sem `closes`/`verify` reprova o runbook", async () => {
  const { construirPendenciasExternas, problemasDasPendencias } = await P()
  const d = construirPendenciasExternas({ cwd: repoRoot, commit: "abc1234" })
  const adulterado = JSON.parse(JSON.stringify(d))
  delete adulterado.pending[0].verify
  assert.ok(problemasDasPendencias(adulterado).some((p) => p.includes("como conferir")))
})

test("o runbook NÃO declara nada certificado — é o que falta, não o que foi feito", async () => {
  const { construirPendenciasExternas } = await P()
  const d = construirPendenciasExternas({ cwd: repoRoot, commit: "abc1234" })
  assert.equal(d.codexHooks.enforcementObserved, false)
  assert.ok(d.doesNotAuthorize.some((x) => x.includes("não declara nada certificado")))
  assert.ok(d.supportMatrix.pendingCells.every((c) => c.verdict === "not_run"))
})

// ── Os artefatos em disco ──────────────────────────────────────────────────

test("os cinco artefatos do S53.0 existem e batem com o que os módulos constroem", async () => {
  const { inventarioDosManuais } = await I()
  const { manifestDeReferencias } = await X()
  const artefatos = [
    ".gstack/evidence/prd52-final.json",
    ".gstack/evidence/external-pending.json",
    ".docs/RESEARCH/prd53-seed-corpus.json",
    ".docs/RESEARCH/prd53-manual-inventory.json",
    ".docs/RESEARCH/prd53-external-refs.json",
  ]
  for (const a of artefatos) assert.ok(existsSync(path.join(repoRoot, a)), `artefato ausente: ${a}`)

  // O conteúdo VOLÁTIL (commit/generatedAt) muda a cada geração; o que precisa
  // bater é a substância. Comparar o documento inteiro exigiria regerar antes de
  // todo teste, e o teste passaria a medir o relógio.
  const invDisco = lerArtefato(".docs/RESEARCH/prd53-manual-inventory.json")
  const invAgora = inventarioDosManuais({ repoRoot, commit: invDisco.sourceCommit })
  assert.deepEqual(invDisco.counts, invAgora.counts, "o inventário em disco divergiu do módulo")

  const refDisco = lerArtefato(".docs/RESEARCH/prd53-external-refs.json")
  const refAgora = manifestDeReferencias({ repoRoot, commit: refDisco.sourceCommit })
  assert.deepEqual(refDisco.counts, refAgora.counts, "o manifest em disco divergiu do módulo")
})

test("todo artefato do S53.0 está RASTREADO no git (§19: artefatos necessários rastreados)", async () => {
  const { execFileSync } = await import("node:child_process")
  // `.docs/` é gitignored — sem `git add -f` o artefato existiria só nesta
  // máquina, que é o oposto de "rastreável".
  const rastreados = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf-8" }).split("\n")
  for (const a of [".docs/RESEARCH/prd53-seed-corpus.json", ".gstack/evidence/prd52-final.json"]) {
    assert.ok(rastreados.includes(a), `artefato não rastreado: ${a}`)
  }
})
