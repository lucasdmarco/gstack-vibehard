import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD51 S51.10.4 — guarda de regressão da fronteira "o manual GUIA o produto, não FAZ
 * PARTE dele".
 *
 * Honestidade sobre o que este arquivo é: hoje a fronteira JÁ está correta — o `files` do
 * package.json é allowlist e nunca incluiu `.docs/`, e nenhum agente carrega o manual.
 * Portanto isto NÃO conserta nada; é guarda de regressão contra o dia em que alguém
 * "simplificar" a allowlist ou resolver injetar o manual no contexto de um agente para
 * dar mais background. O manual tem ~1000 linhas de claims internas: empacotá-lo
 * distribuiria ao cliente final documentação que nunca foi calibrada para ele, e
 * carregá-lo em runtime queimaria contexto com material de curadoria.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))

test("a allowlist do pacote NÃO inclui `.docs/` nem o manual (o cliente final não recebe curadoria interna)", () => {
  const files = pkg.files || []
  assert.ok(files.length > 0, "package.json usa allowlist (`files`), não denylist")
  for (const entry of files) {
    assert.ok(!entry.includes(".docs"), `entrada da allowlist não pode alcançar .docs: ${entry}`)
    assert.ok(!entry.toLowerCase().includes("projetogstack"), `manual não pode ser empacotado: ${entry}`)
  }
})

test("a allowlist não usa curinga de raiz que arrastaria `.docs/` junto sem ninguém notar", () => {
  for (const entry of pkg.files || []) {
    assert.notEqual(entry.trim(), ".", "`.` empacotaria o repositório inteiro")
    assert.notEqual(entry.trim(), "*", "`*` anularia a allowlist")
    assert.notEqual(entry.trim(), "**", "`**` anularia a allowlist")
  }
})

/**
 * Referenciadores LEGÍTIMOS: tratam o manual como OBJETO DE AUDITORIA, não como conteúdo
 * a carregar. Manter a lista curta e justificada é o que dá dente ao guard — um arquivo
 * novo que passe a citar o manual precisa entrar aqui com razão, e é exatamente aí que
 * alguém perceberia uma tentativa de injetar o manual em contexto de agente.
 */
const REFERENCIADORES_PERMITIDOS = Object.freeze({
  "src/meta/manual-lint.js": "É o linter DO manual (S51.10.3) — precisa nomear o arquivo que audita.",
  "src/dream/rc-checklist-prd51.js": "DOD.22 do §9 é literalmente sobre a baseline do manual; o texto do requisito o cita.",
})

test("NENHUM código de runtime carrega o manual — só os referenciadores auditados o citam", () => {
  const dirs = ["src", "agents", "skills", "hooks"].map((d) => path.join(repoRoot, d)).filter((d) => existsSync(d))
  const citantes = []
  const varrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome)
      const st = statSync(p)
      if (st.isDirectory()) { varrer(p); continue }
      if (!/\.(js|mjs|cjs|py)$/.test(nome)) continue
      const txt = readFileSync(p, "utf-8")
      if (/projetogstack|manualdeengenhariacomia/i.test(txt)) citantes.push(path.relative(repoRoot, p).replace(/\\/g, "/"))
    }
  }
  for (const d of dirs) varrer(d)
  const naoAutorizados = citantes.filter((c) => !REFERENCIADORES_PERMITIDOS[c])
  assert.deepEqual(naoAutorizados, [], "manual é fonte de curadoria, nunca runtime — citar exige justificativa registrada")
})

test("a lista de referenciadores permitidos não pode inchar em silêncio — cada um tem razão escrita", () => {
  for (const [arquivo, razao] of Object.entries(REFERENCIADORES_PERMITIDOS)) {
    assert.ok(existsSync(path.join(repoRoot, arquivo)), `${arquivo} ainda existe (senão a permissão é lixo acumulado)`)
    assert.ok(razao.length > 30, `${arquivo} tem razão de verdade, não um rótulo`)
  }
})

test("a matriz de capacidades é DERIVADA de registries reais, não escrita à mão", async () => {
  const mod = path.join(repoRoot, "src", "meta", "capability-bands.js")
  const { buildCapabilityBands } = await import(`${pathToFileURL(mod)}?t=${Date.now()}`)
  const b = buildCapabilityBands().bands
  for (const faixa of ["entregue", "enforced", "advisory", "roadmap"]) {
    assert.equal(b[faixa].derived, true, `${faixa} precisa vir de um registry, não de memória`)
    assert.ok(b[faixa].source.includes("src/"), `${faixa} aponta o arquivo-fonte real`)
    assert.ok(b[faixa].items.length > 0, `${faixa} não pode estar vazia`)
  }
})

test("HONESTIDADE: `experimental` é declarado como NÃO-derivado, com a razão — não finge simetria", async () => {
  const mod = path.join(repoRoot, "src", "meta", "capability-bands.js")
  const { buildCapabilityBands } = await import(`${pathToFileURL(mod)}?t=${Date.now()}`)
  const exp = buildCapabilityBands().bands.experimental
  assert.equal(exp.derived, false, "não há registro legível por máquina para experimental")
  assert.match(exp.source, /declaração manual/i)
  for (const i of exp.items) assert.ok(i.source && i.source.includes("src/"), `${i.id} cita a declaração real em código`)
})

test("cada claim `entregue` liga código, comando e controle negativo (item 4 do §51.10)", async () => {
  const mod = path.join(repoRoot, "src", "meta", "capability-bands.js")
  const { buildCapabilityBands } = await import(`${pathToFileURL(mod)}?t=${Date.now()}`)
  for (const c of buildCapabilityBands().bands.entregue.items) {
    assert.ok(c.evidenceAdapter, `${c.id} aponta o adapter de evidência`)
    assert.ok(c.e2eCommand, `${c.id} aponta o comando que a exercita`)
    assert.ok(c.negativeControl, `${c.id} aponta o controle negativo que a reprova`)
  }
})

test("o manual, se presente, carrega a seção GERADA — e não uma tabela escrita à mão", () => {
  const manual = path.join(repoRoot, ".docs", "PLANS", "projetogstack.md")
  if (!existsSync(manual)) return // `.docs/` é gitignored: na CI não há o que checar
  const txt = readFileSync(manual, "utf-8")
  assert.match(txt, /<!-- BEGIN capability-bands \(gerado\) -->/, "marcador de início presente")
  assert.match(txt, /<!-- END capability-bands \(gerado\) -->/, "marcador de fim presente")
  assert.match(txt, /Seção GERADA por `node scripts\/capability-bands\.mjs --write`/, "a seção avisa que é gerada")
})

test("o manual, se presente, declara explicitamente que NÃO faz parte do pacote", () => {
  const manual = path.join(repoRoot, ".docs", "PLANS", "projetogstack.md")
  if (!existsSync(manual)) return
  const txt = readFileSync(manual, "utf-8")
  assert.match(txt, /GUIA o produto; nao FAZ PARTE dele/i, "a fronteira fica escrita no próprio manual")
})
