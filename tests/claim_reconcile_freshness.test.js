/**
 * PRD52 S52.D — reconciliação executável (§26.1) e validade do readiness (§26.2).
 *
 * As duas metades atacam o mesmo defeito por lados opostos: uma afirmação
 * envelhece sem que ninguém perceba. O §26.1 pergunta se as projeções da mesma
 * claim ainda dizem a mesma coisa; o §26.2 pergunta se o arquivo no disco ainda
 * autoriza a afirmação que ele carrega.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// ── §26.2: readiness armazenado tem validade ───────────────────────────────

const T0 = Date.parse("2026-08-18T12:00:00Z")
const DOC = {
  generatedAt: "2026-08-18T11:30:00Z",
  staleAfterSeconds: 3600,
  headCommit: "abc1234",
  tools: {
    fallow: { status: "callable", validatedCommand: "npx fallow --version", exitCode: 0 },
    headroom: { status: "callable_not_routed", validatedCommand: "headroom doctor", exitCode: 0 },
  },
}
const ler = async (doc, agoraMs, head = null) => {
  const { readinessConsumivel } = await imp("src/tools/readiness-freshness.js")
  return readinessConsumivel(repoRoot, { doc, agoraMs, head })
}

test("dentro da janela, o estado gravado é consumível como está", async () => {
  const r = await ler(DOC, T0)
  assert.deepEqual(r.capabilities.map((c) => [c.capabilityId, c.consumableStatus]),
    [["fallow", "callable"], ["headroom", "callable_not_routed"]])
  assert.equal(r.anyStale, false)
})

test("CONTROLE NEGATIVO: fora da janela, `callable` vira `stale` — nunca segue callable", async () => {
  const r = await ler(DOC, T0 + 2 * 3600 * 1000)
  assert.ok(r.capabilities.every((c) => c.consumableStatus === "stale"), "toda observação vencida degrada")
  assert.ok(r.capabilities.every((c) => c.degraded), "a degradação é declarada, não deduzida")
  assert.equal(r.anyStale, true)
})

test("CONTROLE NEGATIVO: HEAD diferente do commit observado degrada mesmo dentro da janela", async () => {
  const r = await ler(DOC, T0, "0000fff")
  assert.ok(r.capabilities.every((c) => c.consumableStatus === "stale"), "outro HEAD = outra árvore")
})

test("CONTROLE NEGATIVO: sem prova de sonda, o rótulo não é acreditado", async () => {
  const semProva = { ...DOC, tools: { fallow: { status: "callable" } } }
  const r = await ler(semProva, T0)
  assert.equal(r.capabilities[0].consumableStatus, "unknown", "sem comando/exitCode registrado não há observação")
})

test("`missing` velho também degrada (o negativo não é atemporal)", async () => {
  const doc = { ...DOC, tools: { x: { status: "missing", validatedCommand: "x --version", exitCode: 1 } } }
  const dentro = await ler(doc, T0)
  const fora = await ler(doc, T0 + 2 * 3600 * 1000)
  assert.equal(dentro.capabilities[0].consumableStatus, "missing")
  assert.equal(fora.capabilities[0].consumableStatus, "stale", "a ferramenta pode ter sido instalada desde então")
})

test("capacidadeUtilizavel só diz sim para callable/routed vigentes", async () => {
  const { capacidadeUtilizavel } = await imp("src/tools/readiness-freshness.js")
  const vigente = await ler(DOC, T0)
  const vencido = await ler(DOC, T0 + 2 * 3600 * 1000)
  assert.equal(capacidadeUtilizavel(vigente, "fallow"), true)
  assert.equal(capacidadeUtilizavel(vencido, "fallow"), false, "callable vencido não autoriza contar com a ferramenta")
  assert.equal(capacidadeUtilizavel(vigente, "headroom"), false, "callable_not_routed não é routed")
  assert.equal(capacidadeUtilizavel(vigente, "inexistente"), false)
})

test("arquivo ausente não vira objeto vazio que pareça dado", async () => {
  const r = await ler(null, T0)
  assert.equal(r.present, false)
  assert.deepEqual(r.capabilities, [])
})

test("o readiness REAL do repo é lido e passa pelos portões do §26.2", async () => {
  const { readinessConsumivel } = await imp("src/tools/readiness-freshness.js")
  const r = readinessConsumivel(repoRoot, { agoraMs: Date.now() })
  assert.equal(r.present, true, "o repo tem .gstack/tool-readiness.json")
  // Não afirmamos QUAL é o estado (depende de quando a suíte roda) — afirmamos
  // que todo estado consumível é derivado, e nunca copiado cru do arquivo.
  for (const c of r.capabilities) {
    assert.ok(typeof c.consumableStatus === "string" && c.consumableStatus.length > 0)
    assert.equal(c.degraded, c.consumableStatus !== c.storedStatus)
  }
})

// ── §26.1: reconciliação executável ────────────────────────────────────────

// O leitor falso devolve sempre o MESMO conteúdo, então o recibo tem de trazer o
// hash DESSE conteúdo. Um hash inventado faria o teste medir o detector de drift
// em vez do reconciliador — e os dois já têm prova própria.
const CONTEUDO = "// conteudo estavel do mundo falso"
const HASH = createHash("sha256").update(CONTEUDO, "utf-8").digest("hex")
const ioFalso = { has: () => true, read: () => CONTEUDO }

const claimFalsa = (over = {}) => ({
  id: "verify", status: "REAL", severity: "ALTO",
  receipt: {
    schemaVersion: "gstack.claim-receipt.v1", claimId: "dream_audit:verify", sourceCommit: "abc1234",
    contractHash: "x", generatedAt: "2026-08-18T00:00:00Z",
    observedEvidenceRefs: [],
  },
  ...over,
})

test("claim REAL com toda a evidência observada é `consistent`", async () => {
  const { reconciliarClaim } = await imp("src/dream/claim-reconciler.js")
  const { contractFor } = await imp("src/dream/claim-contract.js")
  const { evidenciasDoContrato } = await imp("src/dream/claim-receipt.js")
  const refs = evidenciasDoContrato(contractFor("verify")).map((p) => ({ path: p, sha256: HASH, state: "observed" }))
  const c = claimFalsa()
  c.receipt.observedEvidenceRefs = refs
  const { registro, problemas } = reconciliarClaim(c, { io: ioFalso })
  assert.deepEqual(problemas, [], "o registro precisa ser válido pelo schema do S52.A")
  assert.equal(registro.consistencyVerdict, "consistent")
})

test("CONTROLE NEGATIVO: REAL com evidência faltando é `fail`, e o schema recusaria `consistent`", async () => {
  const { reconciliarClaim } = await imp("src/dream/claim-reconciler.js")
  const { problemasDaReconciliacao } = await imp("src/meta/prd52-schemas.js")
  const { registro } = reconciliarClaim(claimFalsa(), { io: ioFalso })
  assert.equal(registro.consistencyVerdict, "fail", "afirmar prova sem evidência observada é contradição")
  const mentira = { ...registro, consistencyVerdict: "consistent" }
  assert.ok(problemasDaReconciliacao(mentira).some((p) => p.includes("evidência ausente")),
    "um veredito otimista não passa nem pela própria validação")
})

test("claim rebaixada com evidência intacta é CONFLITO, não `not_proved` silencioso", async () => {
  const { reconciliarClaim } = await imp("src/dream/claim-reconciler.js")
  const { contractFor } = await imp("src/dream/claim-contract.js")
  const { evidenciasDoContrato } = await imp("src/dream/claim-receipt.js")
  const refs = evidenciasDoContrato(contractFor("verify")).map((p) => ({ path: p, sha256: HASH, state: "observed" }))
  const c = claimFalsa({ status: "NOT_PROVED", notProved: true })
  c.receipt.observedEvidenceRefs = refs
  const { registro } = reconciliarClaim(c, { io: ioFalso })
  assert.equal(registro.consistencyVerdict, "inconclusive:claim_conflict",
    "auditor e recibo discordam: quem adjudica é humano, não o comando")
})

test("o audit REAL reconcilia sem registro inválido, e todo veredito é do vocabulário", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const { reconciliarAudit } = await imp("src/dream/claim-reconciler.js")
  const { CONSISTENCY_VERDICTS } = await imp("src/meta/prd52-schemas.js")
  const r = reconciliarAudit(audit({ behavioral: true, receipts: true, commit: "abc1234" }))
  assert.deepEqual(r.invalidRecords, [], "registro que não passa na própria validação não é reconciliação")
  for (const v of Object.keys(r.byVerdict)) assert.ok(CONSISTENCY_VERDICTS.includes(v), `veredito inesperado: ${v}`)
  assert.ok(r.total >= 20, `esperava reconciliar as claims com contrato, veio ${r.total}`)
})

test("claim SEM contrato não entra na reconciliação (verde por ausência de exigência)", async () => {
  const { reconciliarAudit } = await imp("src/dream/claim-reconciler.js")
  const r = reconciliarAudit({ claims: [{ id: "nao-existe-esse-claim", status: "REAL" }] })
  assert.equal(r.total, 0, "sem contrato não há evidência exigida — comparar produziria `consistent` vazio")
})
