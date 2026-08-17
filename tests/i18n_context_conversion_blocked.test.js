import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { readFileSync } from "node:fs"
import { pathToFileURL, fileURLToPath } from "node:url"

/**
 * POR QUE `src/commands/context.js` NAO ESTA EM `convertedFiles`.
 *
 * O arquivo chega a `unknown: 0` — os quatro repasses fecham por
 * `stream-counted-subprocess-origin` e o `:50` pela guarda herdada mais a prova
 * publica de `context --json`. Ele chegou a ser declarado convertido, e foi
 * ERRADO: a medicao mostrou que converter levava `unresolvedProvenance` de 0
 * para 28.
 *
 * `unknown: 0` E CONDICAO NECESSARIA, NAO SUFICIENTE. Cada ponto interpolado
 * in_scope precisa tambem de decisao de provenance declarada, e este arquivo tem
 * 28 deles. Vinte e sete admitem
 * `translate_literal_frame_preserve_interpolations` sem esforco. O 28o nao
 * admite decisao honesta NENHUMA com o vocabulario de hoje.
 *
 * Este arquivo existe para que a proxima tentativa nao repita o caminho: ele
 * prova que o bloqueio e do VOCABULARIO, e não falta de trabalho. Quando a
 * decisao arquitetural for tomada, e este teste que precisa ser reescrito
 * primeiro.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const reg = () => import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)
const loader = () => import(pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js")).href)
const inv = () => import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`)

const ALVO = "src/commands/context.js"
const LINHA_BLOQUEADORA = 201

/** Os pontos do arquivo, medidos pelo gerador OFICIAL. */
async function pontosDoAlvo() {
  const { buildRegistry, CONVERTED_FILES } = await reg()
  const r = buildRegistry([...CONVERTED_FILES, ALVO], { root: repoRoot })
  return r.files[ALVO].entries
}

test("o arquivo NAO esta declarado como convertido", async () => {
  const { CONVERTED_FILES } = await reg()
  assert.ok(!CONVERTED_FILES.includes(ALVO),
    "declarar convertido exige provenance resolvida, e um ponto ainda nao admite decisao")
})

test("e o inventario oficial esta com a invariante de provenance INTACTA", async () => {
  const { buildInventory, phase1Gate } = await inv()
  const g = phase1Gate(buildInventory({ repoRoot }))
  assert.equal(g.provenanceOk, true)
  assert.equal(g.unresolvedProvenance, 0)
})

/**
 * A MEDICAO QUE JUSTIFICA O BLOQUEIO. Se este numero mudar, alguem mexeu no
 * arquivo e a auditoria dos pontos precisa ser refeita antes de tentar de novo.
 */
test("MEDIDO: converter o arquivo traria 28 pontos in_scope sem provenance resolvida", async () => {
  const EM_ESCOPO = new Set(["public_diagnostic", "public_security_decision", "generated_dev_surface", "public_interactive"])
  const pendentes = (await pontosDoAlvo())
    .filter((e) => e.provenance.resolved === false && EM_ESCOPO.has(e.audience))
  assert.equal(pendentes.length, 28)
  assert.equal(pendentes.filter((e) => e.provenance.kind === "interpolated").length, 27)
  assert.equal(pendentes.filter((e) => e.provenance.kind === "no_local_frame").length, 1)
})

/**
 * O PONTO QUE BLOQUEIA, e o que ele carrega.
 *
 * `info` de uma moldura que so tem espacos, interpolando 120 caracteres de
 * `d.evidence` — trecho extraido dos DOCUMENTOS INDEXADOS DO USUARIO pelo
 * `context scout --mode decision_context`. Nao ha uma palavra do GStack ali.
 */
test("o ponto bloqueador e `:201`, e o valor dele vem do documento do USUARIO", async () => {
  const p = (await pontosDoAlvo()).find((e) => e.line === LINHA_BLOQUEADORA)
  assert.ok(p, "se o ponto mudou de linha, a auditoria precisa ser refeita")
  assert.equal(p.provenance.kind, "no_local_frame", "a moldura e so espacamento — nao ha frase a traduzir")
  assert.equal(p.audience, "public_diagnostic")
  assert.ok(p.provenance.ids.includes("evidence"))

  const linha = readFileSync(path.join(repoRoot, ALVO), "utf-8").split(/\r?\n/)[LINHA_BLOQUEADORA - 1]
  assert.match(linha, /d\.evidence/, "o valor interpolado e a evidencia lida do indice do usuario")
})

/**
 * AS DUAS ESTRATEGIAS POSSIVEIS, e por que cada uma MENTE.
 *
 * O `kind` restringe o vocabulario a duas; nenhuma descreve "valor linguistico
 * que pertence ao USUARIO". Este teste fixa a restricao para que uma tentativa
 * futura tropece nela em vez de contorna-la.
 */
test("nenhuma das duas estrategias de `no_local_frame` descreve o ponto sem mentir", async () => {
  const { STRATEGY_BY_KIND, NONLINGUISTIC_VALUE_CATEGORIES, ORIGIN_SOURCE_KINDS } = await loader()

  assert.deepEqual(STRATEGY_BY_KIND.no_local_frame,
    ["preserve_nonlinguistic_dynamic_values", "translate_at_value_origin"],
    "se o vocabulario crescer, e aqui que a proxima tentativa deve comecar")

  // 1. Preservar como valor NAO linguistico exigiria declarar prosa do usuario
  //    como glifo, identificador ou byte de controle.
  for (const c of NONLINGUISTIC_VALUE_CATEGORIES) {
    assert.ok(!/text|prose|human|user/i.test(c),
      `a lista fechada nao tem categoria para texto humano, e \`${c}\` nao serve para um trecho de documento`)
  }

  // 2. Traduzir na origem exigiria ancorar num literal de modulo do PROJETO.
  //    O texto nasce em runtime, do arquivo do usuario — nao ha literal a
  //    apontar. Ver tests/i18n_value_origin_resolution.test.js, que ja prova que
  //    o checker devolve ZERO declaracoes para `d.evidence`.
  assert.deepEqual(ORIGIN_SOURCE_KINDS, ["project_module_literal"],
    "a origem precisa ser um literal do projeto, e `d.evidence` nao e")
})

/**
 * O QUE A LEVA ENTREGOU CONTINUA ENTREGUE. Reverter a declaracao de conversao
 * nao pode levar junto as capacidades — elas sao independentes e provadas.
 */
test("as capacidades da leva seguem vivas, mesmo com o arquivo fora", async () => {
  const eng = await import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)
  const ids = eng.SINK_RULES.map((r) => r.id)
  assert.ok(ids.includes("stream-external-passthrough"), "C-4(a)")
  assert.ok(ids.includes("stream-counted-subprocess-origin"), "repasse com origem contada")
  assert.equal(typeof eng.underInheritedMachineGuard, "function", "guarda herdada")
  assert.equal(typeof eng.chamadaDeSubprocesso, "function", "provador de origem")

  const { distributedPythonFiles } = await inv()
  assert.ok(distributedPythonFiles(repoRoot).has("src/context-docs/py/context_db.py"),
    "a fronteira Python derivada segue contando o indexer")
})
