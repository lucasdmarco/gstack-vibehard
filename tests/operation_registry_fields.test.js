/**
 * PRD52 S52.H (ADR-006) — os quatro campos novos do `operation-registry`.
 *
 * O que estes testes defendem não é a existência dos campos; é a DISCIPLINA que
 * autorizou estendê-los em vez de criar um segundo registry: opcionais, nunca
 * inferidos, e verificados contra a CLI real. Sem essas três, a extensão vira o
 * `command-registry.js` que o ADR-006 recusou, só que com outro nome.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const F = () => imp("src/meta/operation-registry-fields.js")
const R = () => imp("src/meta/operation-registry.js")

const dispatch = async () => {
  const { chavesDoDispatch } = await F()
  return chavesDoDispatch(readFileSync(path.join(repoRoot, "src", "cli", "index.js"), "utf-8"))
}

test("as chaves do DISPATCH são lidas da CLI real (49 comandos, `help` entre eles)", async () => {
  const keys = await dispatch()
  assert.ok(keys.size >= 40, `esperava o dispatch inteiro, veio ${keys.size}`)
  for (const esperado of ["start", "verify", "prd", "visual", "research", "plan", "tools", "pp"]) {
    assert.ok(keys.has(esperado), `dispatch sem '${esperado}'`)
  }
})

test("toda declaração dos campos novos aponta para algo que EXISTE", async () => {
  const { OPERATION_REGISTRY } = await R()
  const { problemasDosCamposNovos } = await F()
  const r = problemasDosCamposNovos(OPERATION_REGISTRY, await dispatch())
  assert.deepEqual(r.brokenDeclarations, [],
    "handler/alias/help declarados têm de existir na CLI — declaração sem destino é pior que ausência")
})

test("CONTROLE NEGATIVO: handler, alias e help inexistentes são acusados, cada um pelo seu tipo", async () => {
  const { problemasDosCamposNovos } = await F()
  const keys = await dispatch()
  const inventado = [
    { command: "x", subcommand: null, effects: ["read"], handler: "naoexiste" },
    { command: "y", subcommand: null, effects: ["read"], alias: "tambemnao" },
    { command: "z", subcommand: null, effects: ["read"], help: "nemesse" },
  ]
  const kinds = problemasDosCamposNovos(inventado, keys).brokenDeclarations.map((b) => b.kind)
  assert.deepEqual(kinds.sort(), ["alias", "handler", "help"])
})

test("A DISCIPLINA: campo ausente NÃO é inferido pelo nome do comando", async () => {
  const { handlersInexistentes, helpsInexistentes } = await F()
  const keys = await dispatch()
  // `doctor` existe no DISPATCH; se a ausência fosse inferida pelo nome, esta
  // entrada passaria a ter handler sem ninguém ter auditado nada.
  const semDeclaracao = [{ command: "doctor", subcommand: null, effects: ["read"] }]
  assert.deepEqual(handlersInexistentes(semDeclaracao, keys), [], "sem declaração não há o que validar")
  assert.deepEqual(helpsInexistentes(semDeclaracao), [])
  const { CAMPOS_OPCIONAIS } = await F()
  for (const campo of CAMPOS_OPCIONAIS) {
    assert.equal(semDeclaracao[0][campo], undefined, `'${campo}' apareceu sem ter sido declarado`)
  }
})

test("toda flag declarada está documentada no help — a superfície real É a documentada", async () => {
  const { OPERATION_REGISTRY } = await R()
  const { flagsNaoDocumentadas } = await F()
  assert.deepEqual(flagsNaoDocumentadas(OPERATION_REGISTRY), [],
    "flag que o código lê e o help não menciona só é usável por quem leu a fonte")
})

test("CONTROLE NEGATIVO: flag não documentada é acusada com o nome dela", async () => {
  const { flagsNaoDocumentadas } = await F()
  const r = flagsNaoDocumentadas([
    { command: "prd", subcommand: "status", help: "prd", flags: ["--json", "--inventada"] },
  ])
  assert.equal(r.length, 1)
  assert.deepEqual(r[0].undocumented, ["--inventada"])
})

test("flags quebradas saem SEPARADAS de declaração quebrada (problemas diferentes)", async () => {
  const { problemasDosCamposNovos } = await F()
  const r = problemasDosCamposNovos(
    [{ command: "prd", subcommand: "status", help: "prd", flags: ["--inventada"] }], await dispatch())
  assert.deepEqual(r.brokenDeclarations, [], "o help existe: a declaração não está quebrada")
  assert.equal(r.undocumentedFlags.length, 1,
    "é lacuna de documentação do produto, não erro do registry — misturar faria consertarem apagando a verdade")
})

test("ADR-006 cumprido: NÃO existe um segundo registry sobre os mesmos comandos", async () => {
  const { existsSync } = await import("node:fs")
  assert.equal(existsSync(path.join(repoRoot, "src", "meta", "command-registry.js")), false,
    "dois registries produziriam duas verdades, e a segunda envelheceria calada")
})

test("as operações auditadas declaram os quatro campos onde foram auditadas", async () => {
  const { OPERATION_REGISTRY } = await R()
  const comHandler = OPERATION_REGISTRY.filter((e) => e.handler)
  assert.ok(comHandler.length >= 8, `esperava as operações já auditadas declaradas, veio ${comHandler.length}`)
  for (const e of comHandler) {
    assert.ok(e.help, `'${e.command}' declara handler mas não help`)
    assert.ok(Array.isArray(e.flags), `'${e.command}' declara handler mas não a lista de flags`)
  }
})
