import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// Captura stdout E o exitCode que o comando definiu, restaurando o exitCode do
// processo em seguida (senão um comando que sai !=0 contamina a suíte inteira).
async function captureFull(fn) {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  const prevExit = process.exitCode
  process.exitCode = 0
  let exitCode = 0
  try { await fn(); exitCode = process.exitCode || 0 }
  finally { process.stdout.write = orig; process.exitCode = prevExit }
  return { out: out.trim(), exitCode }
}

async function capture(fn) {
  return (await captureFull(fn)).out
}

/** PRD50 S50.4 — `research validate` (§13.1). Knowledge: read-only, nunca executa. */

test("research validate --json: JSON PURO, uma linha, schema correto", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await capture(() => researchCommand(["validate", "o evidence-ledger inclui llm em PROVING_SOURCES", "--json"], {}))
  const parsed = JSON.parse(out.split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.epistemic-review.v1")
  assert.ok(parsed.verdict, "sempre há veredito")
})

test("research validate: classifica o nível e diz POR QUE", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await capture(() => researchCommand(["validate", "isso é seguro para release?", "--json"], {}))
  const parsed = JSON.parse(out.split("\n").pop())
  assert.ok(["sanity", "grounded", "adversarial"].includes(parsed.level))
  assert.ok(parsed.classificationReasons.length > 0)
})

test("--level adversarial: usuário ELEVA o nível livremente (§9.3)", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await capture(() => researchCommand(["validate", "pergunta trivial", "--level", "adversarial", "--json"], {}))
  assert.equal(JSON.parse(out.split("\n").pop()).level, "adversarial")
})

test("CONTROLE NEGATIVO: sem rede autorizada, o review NUNCA alega consulta externa", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await capture(() => researchCommand(["validate", "qual a versão mais recente do node?", "--json"], {}))
  const parsed = JSON.parse(out.split("\n").pop())
  assert.deepEqual(parsed.sources, [], "nenhuma fonte sem rede")
  assert.ok(parsed.notPerformed.length > 0, "declara o que não fez")
  assert.notEqual(parsed.verdict, "supported")
})

test("CONTROLE NEGATIVO: research validate NUNCA executa código (Knowledge)", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await capture(() => researchCommand(["validate", "a função ordena a lista", "--json"], {}))
  const parsed = JSON.parse(out.split("\n").pop())
  assert.ok(parsed.notPerformed.some((n) => /nenhum código|não executa/i.test(n)))
  assert.deepEqual(parsed.tools, [], "nenhuma ferramenta invocada pela camada Knowledge")
})

test("research validate sem argumento -> erro honesto, exitCode 2 (§13.4)", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const r = await captureFull(() => researchCommand(["validate", "--json"], {}))
  assert.equal(r.exitCode, 2, "uso inválido = 2")
})

test("§13.4: inconclusive sai com 0; --strict sai com 3", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const normal = await captureFull(() => researchCommand(["validate", "claim sem evidência local", "--json"], {}))
  assert.equal(normal.exitCode, 0, "inconclusive é conclusão honesta, não erro")
  const strict = await captureFull(() => researchCommand(["validate", "claim sem evidência local", "--json", "--strict"], {}))
  assert.equal(strict.exitCode, 3, "--strict exige supported")
})

test("render humano mostra veredito, o que falta e o que NÃO foi executado", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await capture(() => researchCommand(["validate", "algo verificável"], {}))
  assert.match(out, /Veredito:/)
  assert.match(out, /Não executado:/)
})

test("REGRESSÃO: os subcomandos existentes de research continuam funcionando", async () => {
  const { researchCommand } = await imp("src/commands/research.js")
  const out = await capture(() => researchCommand(["notebooklm", "doctor", "--json"], {}))
  assert.equal(JSON.parse(out.split("\n").pop()).status, "not_configured")
})

test("research continua sendo camada KNOWLEDGE no firewall", async () => {
  const { layerOf } = await imp("src/meta/command-layers.js")
  assert.equal(layerOf("research"), "knowledge")
})
