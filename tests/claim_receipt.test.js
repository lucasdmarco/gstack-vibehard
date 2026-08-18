/**
 * PRD52 S52.C — recibos de claim ancorados por hash.
 *
 * O recibo prova IDENTIDADE da evidência no tempo, não que o comportamento
 * funciona. Os testes abaixo perseguem essa distinção: um recibo tem de detectar
 * que a evidência mudou, que sumiu, e que a própria DECLARAÇÃO foi trocada por
 * baixo dele — as três formas de um verde envelhecer sem ninguém perceber.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const R = () => imp("src/dream/claim-receipt.js")

const leitorFalso = (arquivos) => ({
  has: (rel) => Object.prototype.hasOwnProperty.call(arquivos, rel),
  read: (rel) => arquivos[rel] ?? "",
})

const MUNDO = {
  "src/skills/coisa.js": "export const coisa = 1",
  "src/index.js": "// cli",
  "tests/coisa.test.js": "// reprova se coisa sumir",
}

const CONTRATO = Object.freeze({
  evidenceAdapter: "src/skills/coisa.js",
  e2eCommand: "node src/index.js coisa",
  negativeControl: "tests/coisa.test.js — reprova",
  freshness: "por-run",
})

const emitir = async (io = leitorFalso(MUNDO), extra = {}) => {
  const { emitirRecibo } = await R()
  return emitirRecibo({ claimId: "coisa", contract: CONTRATO, io, sourceCommit: "abc1234", agora: "2026-08-18T00:00:00Z", ...extra })
}

test("o recibo enumera a evidência derivada do CONTRATO, não de uma lista paralela", async () => {
  const rec = await emitir()
  assert.deepEqual(rec.observedEvidenceRefs.map((r) => r.path).sort(),
    ["src/index.js", "src/skills/coisa.js", "tests/coisa.test.js"])
  assert.ok(rec.observedEvidenceRefs.every((r) => r.sha256 && r.state === "observed"))
})

test("o claimId do recibo é a forma canônica do S52.A", async () => {
  const rec = await emitir()
  const { parseClaimId } = await imp("src/meta/claim-id.js")
  assert.deepEqual(parseClaimId(rec.claimId), { source: "dream_audit", localId: "coisa" })
})

test("CONTROLE NEGATIVO: arquivo de evidência que MUDA é acusado", async () => {
  const { driftDoRecibo } = await R()
  const rec = await emitir()
  const depois = leitorFalso({ ...MUNDO, "src/skills/coisa.js": "export const coisa = 2" })
  const d = driftDoRecibo(rec, depois)
  assert.equal(d.length, 1, `esperava uma divergência, veio ${JSON.stringify(d)}`)
  assert.equal(d[0].state, "changed")
  assert.equal(d[0].path, "src/skills/coisa.js")
  assert.notEqual(d[0].expected, d[0].actual)
})

test("CONTROLE NEGATIVO: evidência que SOME é acusada (nunca omitida em silêncio)", async () => {
  const { driftDoRecibo } = await R()
  const rec = await emitir()
  const semTeste = { ...MUNDO }
  delete semTeste["tests/coisa.test.js"]
  const d = driftDoRecibo(rec, leitorFalso(semTeste))
  assert.deepEqual(d.map((x) => [x.path, x.state]), [["tests/coisa.test.js", "missing"]])
})

test("evidência ausente na emissão entra como `missing`, não desaparece da lista", async () => {
  const semAdapter = { ...MUNDO }
  delete semAdapter["src/skills/coisa.js"]
  const rec = await emitir(leitorFalso(semAdapter))
  const ref = rec.observedEvidenceRefs.find((r) => r.path === "src/skills/coisa.js")
  assert.equal(ref.state, "missing")
  assert.equal(ref.sha256, null)
})

test("CONTROLE NEGATIVO: trocar a DECLARAÇÃO invalida o recibo mesmo com arquivos intactos", async () => {
  const { reciboConfere } = await R()
  const io = leitorFalso(MUNDO)
  const rec = await emitir(io)
  assert.equal(reciboConfere(rec, CONTRATO, io).ok, true, "sem mudança nenhuma, o recibo confere")
  const outro = { ...CONTRATO, negativeControl: "tests/coisa.test.js — outro motivo" }
  const v = reciboConfere(rec, outro, io)
  assert.equal(v.ok, false)
  assert.equal(v.reason, "contrato_mudou")
})

test("reciboConfere devolve o MOTIVO, não só um booleano", async () => {
  const { reciboConfere } = await R()
  const rec = await emitir()
  const v = reciboConfere(rec, CONTRATO, leitorFalso({ ...MUNDO, "src/index.js": "// outro" }))
  assert.equal(v.ok, false)
  assert.equal(v.reason, "evidencia_mudou")
  assert.equal(v.detail[0].path, "src/index.js")
})

test("CONTROLE NEGATIVO: recibo sem commit ou sem evidência é inválido", async () => {
  const { problemasDoRecibo } = await R()
  const rec = await emitir()
  assert.deepEqual(problemasDoRecibo(rec), [], "o recibo de referência é válido")
  assert.ok(problemasDoRecibo({ ...rec, sourceCommit: null }).some((p) => p.includes("sourceCommit")),
    "recibo sem commit não ancora nada no tempo")
  assert.ok(problemasDoRecibo({ ...rec, observedEvidenceRefs: [] }).some((p) => p.includes("não observou nada")),
    "recibo vazio não prova nada")
})

test("o auditor real emite recibo para toda claim com contrato, com o commit injetado", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const { problemasDoRecibo } = await R()
  const r = audit({ behavioral: true, receipts: true, commit: "deadbee" })
  const comRecibo = r.claims.filter((c) => c.receipt)
  assert.ok(comRecibo.length >= 20, `esperava recibo na maioria das claims, veio ${comRecibo.length}`)
  for (const c of comRecibo) {
    assert.deepEqual(problemasDoRecibo(c.receipt), [], `recibo inválido em '${c.id}'`)
    assert.equal(c.receipt.sourceCommit, "deadbee", "o commit vem de FORA — o auditor não chama git")
  }
})

test("recibo é opt-in: sem `receipts` o audit não muda de forma", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const r = audit({ behavioral: true })
  assert.ok(r.claims.every((c) => !c.receipt), "anexar recibo por padrão cobraria releitura de quem não pediu")
})

test("os recibos do repo REAL conferem contra o próprio repo", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const { reciboConfere } = await R()
  const { contractFor } = await imp("src/dream/claim-contract.js")
  const r = audit({ behavioral: true, receipts: true, commit: "HEADREAL" })
  for (const c of r.claims.filter((x) => x.receipt)) {
    const v = reciboConfere(c.receipt, contractFor(c.id))
    assert.equal(v.ok, true, `'${c.id}': ${v.reason} — ${JSON.stringify(v.detail)}`)
  }
})
