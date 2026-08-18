/**
 * PRD52 S52.G — a fronteira com PRD53/54 é gate, não acordo.
 *
 * O risco desta fase é específico e concreto: os schemas do §25 estão prontos, e
 * escrever o motor em cima deles é a coisa mais natural do mundo. Seria também o
 * modo de o PRD54 começar sem ninguém ter decidido que começou. Estes testes
 * existem para que isso não possa acontecer em silêncio.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const B = () => imp("src/meta/prd52-boundaries.js")

test("a fronteira está sendo RESPEITADA no repo real", async () => {
  const { relatorioDaFronteira } = await B()
  const r = relatorioDaFronteira(repoRoot)
  assert.deepEqual(r.violations, [],
    `capacidade do PRD54 implementada no PRD52: ${JSON.stringify(r.violations)}`)
  assert.equal(r.enforced, true)
})

test("CONTROLE NEGATIVO: um export do PRD54 é acusado com arquivo e capacidade", async () => {
  const { violacoesDaFronteira } = await B()
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-fronteira-"))
  try {
    await mkdir(path.join(dir, "src", "dream"), { recursive: true })
    await writeFile(path.join(dir, "src", "dream", "motor.js"),
      "export function renovarLease(lease) { return lease }\n")
    const v = violacoesDaFronteira(dir)
    assert.equal(v.length, 1)
    assert.deepEqual(v[0], { file: "src/dream/motor.js", capability: "renovarLease", owner: "prd54" })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("a guarda olha EXPORTS, não palavras soltas — comentário não é capacidade", async () => {
  const { violacoesDaFronteira } = await B()
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-fronteira-doc-"))
  try {
    await mkdir(path.join(dir, "src", "meta"), { recursive: true })
    await writeFile(path.join(dir, "src", "meta", "doc.js"),
      "// Não há scheduleMission aqui: o scheduler é do PRD54, e renovarLease também.\nexport const x = 1\n")
    assert.deepEqual(violacoesDaFronteira(dir), [],
      "procurar palavra no texto faria a guarda gritar com a própria documentação")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("cada capacidade tem UM dono — nada aparece em dois programas", async () => {
  const { PROGRAM_BOUNDARIES } = await B()
  const todas = Object.values(PROGRAM_BOUNDARIES).flatMap((p) => p.owns)
  assert.equal(new Set(todas).size, todas.length, "capacidade em dois programas é fronteira sem fronteira")
})

test("o PRD54 consome os schemas do §25 — que o PRD52 possui e NÃO usa", async () => {
  const { PROGRAM_BOUNDARIES } = await B()
  assert.ok(PROGRAM_BOUNDARIES.prd52.schemas.includes("src/meta/mission-schemas.js"), "o §25 é propriedade do PRD52")
  assert.ok(PROGRAM_BOUNDARIES.prd54.consumes.includes("src/meta/mission-schemas.js"), "e é a interface entregue ao PRD54")
  assert.ok(PROGRAM_BOUNDARIES.prd54.owns.some((c) => c.includes("motor")), "o motor é do PRD54, e só dele")
})

test("A TRAVA DO PROGRAMA: nenhum comando da CLI executa missão autônoma", async () => {
  const { relatorioDaFronteira } = await B()
  const r = relatorioDaFronteira(repoRoot)
  // `src/commands` está entre os diretórios varridos: se um subcomando de missão
  // aparecesse, ele seria acusado aqui antes de chegar ao usuário.
  assert.equal(r.enforced, true, "o PRD52 não implementa loop autônomo, e isto é conferido, não prometido")
})
