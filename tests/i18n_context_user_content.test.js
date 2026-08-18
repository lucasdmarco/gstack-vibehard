import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { readFileSync } from "node:fs"
import { pathToFileURL, fileURLToPath } from "node:url"

/**
 * `src/commands/context.js` — O BLOQUEIO, E COMO ELE FOI RESOLVIDO.
 *
 * Este arquivo nasceu registrando por que a conversao NAO podia acontecer, e
 * agora guarda o caminho inteiro, porque as duas metades importam:
 *
 *   1. o arquivo chegou a `unknown: 0` e foi declarado convertido -- ERRADO.
 *      Converter levou `unresolvedProvenance` de 0 para 28. `unknown: 0` e
 *      condicao NECESSARIA, nao suficiente: cada ponto interpolado in_scope
 *      tambem precisa de decisao de provenance declarada;
 *   2. auditados um a um, 27 dos 28 admitiam
 *      `translate_literal_frame_preserve_interpolations`. O 28o -- `:201`,
 *      trecho de documento indexado do USUARIO -- nao cabia em nenhuma das tres
 *      estrategias de entao sem mentir no unico campo conferivel;
 *   3. a decisao arquitetural foi tomada e `preserve_user_content_verbatim`
 *      entrou no vocabulario;
 *   4. so entao o arquivo voltou a `convertedFiles`.
 *
 * O que este arquivo protege hoje e a INVARIANTE que a reversao ensinou, e o
 * caso concreto que a exercita.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const reg = () => import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)
const loader = () => import(pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js")).href)
const inv = () => import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`)

const ALVO = "src/commands/context.js"
const LINHA_DO_USUARIO = 243

test("o arquivo esta convertido, e com a provenance INTEIRA declarada", async () => {
  const { CONVERTED_FILES } = await reg()
  assert.ok(CONVERTED_FILES.includes(ALVO))

  const { buildInventory, phase1Gate } = await inv()
  const g = phase1Gate(buildInventory({ repoRoot }))
  assert.equal(g.provenanceOk, true)
  assert.equal(g.unresolvedProvenance, 0)
})

/**
 * A INVARIANTE QUE A REVERSAO ENSINOU, escrita como asercao: nenhum arquivo
 * convertido pode ter ponto in_scope com provenance nao resolvida. E o controle
 * que faltava quando `context.js` entrou na primeira vez.
 */
test("NENHUM arquivo convertido tem ponto in_scope com provenance pendente", async () => {
  const { buildInventory, isInScope } = await inv()
  const i = buildInventory({ repoRoot })
  const convertidos = new Set(i.jsRegistry.convertedFiles)
  const pendentes = i.points
    .filter((p) => convertidos.has(p.file) && isInScope(p.audience) && p.provenance?.resolved === false
      && !p.provenanceDecision)
    .map((p) => `${p.file}:${p.line}:${p.column}`)
  assert.deepEqual(pendentes, [],
    "declarar convertido exige provenance resolvida ou decisao declarada — `unknown: 0` nao basta")
})

// ── O ponto que exigiu a estrategia nova ───────────────────────────────────

test("`:243` e `user_content`, fora da claim, e NAO `public_diagnostic`", async () => {
  const { buildInventory } = await inv()
  const p = buildInventory({ repoRoot }).points.find((x) => x.file === ALVO && x.line === LINHA_DO_USUARIO)
  assert.ok(p, "se o ponto mudou de linha, a auditoria precisa ser refeita")
  assert.equal(p.audience, "user_content")
  assert.equal(p.classification, "out_of_scope",
    "traduzir aqui alteraria a citacao que o usuario pediu para ver")
})

test("e ele declara `preserve_user_content_verbatim`, com especie e fronteira", async () => {
  const overrides = JSON.parse(readFileSync(path.join(repoRoot, "src/meta/i18n-js-overrides.json"), "utf-8"))
  const d = overrides.provenanceDecisions.find((x) => x.file === ALVO && x.line === LINHA_DO_USUARIO)
  assert.ok(d, "o ponto precisa de decisao propria")
  assert.equal(d.strategy, "preserve_user_content_verbatim")
  assert.equal(d.translationSite, undefined, "esta estrategia nao traduz em lugar nenhum")

  for (const id of d.interpolations) {
    assert.equal(d.values[id].sourceKind, "indexed_user_document")
    assert.equal(d.values[id].boundary, "subprocess_stdout")
  }
})

/**
 * A CADEIA, provada no arquivo Python: `evidence` sai de uma COLUNA do indice, e
 * nao de um literal. E o que separa "nosso subprocesso PRODUZIU o texto" de
 * "nosso subprocesso CARREGOU o texto do usuario" — a distincao inteira de que a
 * estrategia depende.
 */
test("CADEIA: o Python CARREGA o texto do usuario, nao o produz", async () => {
  const py = readFileSync(path.join(repoRoot, "src/context-docs/py/context_db.py"), "utf-8")
  const linhas = py.split(/\r?\n/)

  const daEvidencia = linhas.find((l) => l.includes('"evidence":'))
  assert.ok(daEvidencia, "se o montador de `evidence` mudou, a decisao precisa ser reauditada")

  // So o lado do VALOR: a chave `"evidence"` e literal, mas e nome de campo do
  // payload, nao conteudo. Confundir os dois foi o primeiro erro desta asercao.
  const valor = daEvidencia.slice(daEvidencia.indexOf('"evidence":') + '"evidence":'.length)
  assert.match(valor, /r\["content"\]/, "o valor vem da coluna `chunks.content`")

  // O nome da COLUNA tambem e literal com letras, e tambem nao e conteudo: ele
  // SELECIONA o dado, nao contribui texto. Tirado ele, o que sobra de literal no
  // valor precisa ser so o fallback vazio.
  const semLookup = valor.replace(/r\["content"\]/g, "«coluna»")
  assert.doesNotMatch(semLookup, /"[^"]*\p{L}[^"]*"/u,
    "nenhum literal com letra entra no valor — so o fallback vazio, `strip` e o corte")

  // CONTRASTE no mesmo arquivo: aqui SIM ha literal nosso, e ele segue contado
  // como mensagem do produto, na origem.
  assert.match(linhas[539], /sem resultados/, "literal do GStack, e nao do usuario")
  const { buildInventory } = await inv()
  const naOrigem = buildInventory({ repoRoot }).points
    .find((p) => p.file.endsWith("context_db.py") && p.line === 540 && p.sink === "print")
  assert.equal(naOrigem.audience, "public_diagnostic")
  assert.equal(naOrigem.classification, "in_scope")
})

test("a origem Python continua contada — a conversao do sink nao a apagou", async () => {
  const { buildInventory } = await inv()
  const py = buildInventory({ repoRoot }).points.filter((p) => p.file.endsWith("context_db.py"))
  assert.equal(py.length, 19)
  assert.equal(py.filter((p) => p.classification === "in_scope").length, 9)
})

// ── As tres estrategias anteriores continuam sem descrever o caso ──────────

/**
 * O motivo pelo qual a quarta estrategia precisou existir. Se um dia alguem
 * quiser remove-la, e aqui que vai tropecar.
 */
test("as tres estrategias anteriores continuam mentindo sobre este ponto", async () => {
  const { NONLINGUISTIC_VALUE_CATEGORIES, ORIGIN_SOURCE_KINDS, STRATEGY_BY_KIND } = await loader()

  assert.ok(STRATEGY_BY_KIND.no_local_frame.includes("preserve_user_content_verbatim"))

  for (const c of NONLINGUISTIC_VALUE_CATEGORIES) {
    assert.ok(!/text|prose|human|user/i.test(c),
      `nenhuma categoria nao-linguistica serve para um trecho de documento (\`${c}\`)`)
  }
  assert.deepEqual(ORIGIN_SOURCE_KINDS, ["project_module_literal"],
    "traduzir na origem exigiria um literal do PROJETO, e o texto nasce em runtime")
})
