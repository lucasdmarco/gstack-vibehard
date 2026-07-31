import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD51 S51.10.2 — a matriz mínima do §51.10 registrada com escopo honesto.
 *
 * O risco que este arquivo existe para impedir é o de declarar cobertura por INFERÊNCIA:
 * "há um job chamado `test` rodando em três SOs, logo a matriz está coberta". Cada
 * dimensão precisa apontar teste ou job REAL, e cada lacuna precisa estar escrita — do
 * contrário o registro vira exatamente o tipo de claim que o PRD51 inteiro combate.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "release", "rc-matrix.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("cobre as 10 dimensões da matriz mínima do §51.10, cada uma com status do vocabulário fechado", async () => {
  const { RC_MATRIX, RC_MATRIX_STATUSES } = await imp()
  assert.equal(RC_MATRIX.length, 10, "§51.10 lista 10 dimensões")
  const permitidos = new Set(RC_MATRIX_STATUSES)
  for (const d of RC_MATRIX) {
    assert.ok(permitidos.has(d.status), `${d.id} usa status do vocabulário fechado`)
    assert.ok(d.dimension && d.dimension.length > 5, `${d.id} descreve a dimensão`)
  }
})

test("INVARIANTE: dimensão `proven` aponta teste ou job real — nunca 'coberto' por afirmação", async () => {
  const { RC_MATRIX } = await imp()
  for (const d of RC_MATRIX.filter((x) => x.status === "proven")) {
    const temEvidencia = d.provedBy.length > 0 || d.ci.length > 0
    assert.ok(temEvidencia, `${d.id} precisa citar prova ou job`)
    assert.equal(d.gap, null, `${d.id} é proven, então não pode carregar lacuna`)
  }
})

test("INVARIANTE: toda dimensão NÃO-proven explica a lacuna — nada fica implícito", async () => {
  const { RC_MATRIX } = await imp()
  const naoProvadas = RC_MATRIX.filter((d) => d.status !== "proven")
  assert.ok(naoProvadas.length > 0, "hoje a matriz tem lacunas reais; se zerar, este teste avisa")
  for (const d of naoProvadas) {
    assert.ok(d.gap && d.gap.length > 40, `${d.id} explica o que falta e por quê`)
  }
})

test("todo teste citado como prova EXISTE em disco (a regra que o S51.3 aprendeu quebrando)", async () => {
  const { RC_MATRIX } = await imp()
  for (const d of RC_MATRIX) {
    for (const p of d.provedBy) {
      assert.ok(existsSync(path.join(repoRoot, p)), `prova de ${d.id} existe: ${p}`)
    }
  }
})

test("todo job de CI citado existe mesmo no workflow (arquivo:job), não é nome inventado", async () => {
  const { RC_MATRIX } = await imp()
  const cache = new Map()
  for (const d of RC_MATRIX) {
    for (const ref of d.ci) {
      const [arquivo, job] = ref.split(":")
      const abs = path.join(repoRoot, ".github", "workflows", arquivo)
      assert.ok(existsSync(abs), `workflow citado por ${d.id} existe: ${arquivo}`)
      if (!cache.has(abs)) cache.set(abs, readFileSync(abs, "utf-8"))
      assert.match(cache.get(abs), new RegExp(`^\\s{2}${job}:`, "m"), `job '${job}' existe em ${arquivo} (citado por ${d.id})`)
    }
  }
})

test("falha de rede está declarada como lacuna REAL, não maquiada com um mock que só prova o mock", async () => {
  const { RC_MATRIX } = await imp()
  const rede = RC_MATRIX.find((d) => d.id === "network-failure")
  assert.equal(rede.status, "missing")
  assert.deepEqual(rede.provedBy, [], "nenhuma prova inventada")
  assert.match(rede.gap, /injeção|inje/i, "diz o que seria preciso para fechar")
})

test("rcMatrixVerdict: `complete` exige matriz INTEIRA — partial não conta como coberto", async () => {
  const { rcMatrixVerdict, RC_MATRIX } = await imp()
  const v = rcMatrixVerdict()
  assert.equal(v.complete, false, "há lacunas hoje; o veredito não pode arredondar para completo")
  assert.equal(v.counts.total, RC_MATRIX.length)
  assert.equal(v.counts.proven + v.counts.partial + v.counts.missing, v.counts.total)
  for (const o of v.open) assert.ok(o.gap, `${o.id} leva o motivo junto`)
})

test("CONTROLE POSITIVO: matriz sem lacunas vira complete — o caminho existe, não é inalcançável", async () => {
  const { rcMatrixVerdict, RC_MATRIX } = await imp()
  const tudoProvado = RC_MATRIX.map((d) => ({ ...d, status: "proven", gap: null }))
  const v = rcMatrixVerdict(tudoProvado)
  assert.equal(v.complete, true)
  assert.equal(v.open.length, 0)
})

test("CONTROLE NEGATIVO: uma única dimensão `partial` já derruba `complete`", async () => {
  const { rcMatrixVerdict, RC_MATRIX } = await imp()
  const quase = RC_MATRIX.map((d, i) => (i === 0 ? { ...d, status: "partial", gap: "lacuna sintética deste controle negativo" } : { ...d, status: "proven", gap: null }))
  const v = rcMatrixVerdict(quase)
  assert.equal(v.complete, false, "quase toda a matriz não é a matriz")
  assert.equal(v.counts.partial, 1)
})
