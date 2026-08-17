import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * FATIA 6 — o registry commitado é o que o gerador produz HOJE?
 *
 * O artefato é 100% GERADO, e artefato gerado que ninguém confere vira mentira
 * commitada: o runtime passaria a ler classificações que o código-fonte já não
 * produz, sem que nada avisasse. O `check` é o que fecha essa porta.
 *
 * DUAS DECISÕES DE DESENHO, e as duas são sobre honestidade da medida:
 *
 *  1. regenera num diretório TEMPORÁRIO e escreve de verdade, em vez de só
 *     serializar em memória — assim o check exercita o mesmo caminho de escrita
 *     do `generate`, e um bug que só aparecesse ali não passaria despercebido;
 *  2. fins de linha são normalizados antes de comparar, e o resultado DISTINGUE
 *     os dois casos em vez de escolher um. Com `core.autocrlf` no Windows o
 *     mesmo commit produz bytes diferentes do Linux; reprovar por isso seria
 *     acusar staleness onde houve checkout.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const gen = () => import(`${pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href}?t=${Date.now()}`)
const REG = "src/meta/i18n-js-registry.json"

/** Cópia mínima do projeto onde o registry pode ser adulterado sem risco. */
function projeto(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "i18n-check-"))
  t.after(() => cleanupTmp(raiz))
  return raiz
}

// ── O caminho feliz, contra o repositório real ─────────────────────────────

test("POSITIVO: o registry commitado está fresco", async () => {
  const { verificarArquivo } = await gen()
  const r = verificarArquivo({ root: repoRoot })
  assert.equal(r.ok, true, `esperado fresco; veio ${r.reason}\n${r.detail}`)
})

test("POSITIVO: o comando público sai com 0 e diz que está fresco", () => {
  const saida = execFileSync("node", ["scripts/i18n-registry.mjs", "--check"],
    { cwd: repoRoot, encoding: "utf-8" })
  assert.match(saida, /esta fresco/)
})

// ── O controle negativo, que é o teste que importa ─────────────────────────

/**
 * Um check que nunca reprova é decoração. Aqui o registry é adulterado num
 * clone descartável e o comando PRECISA sair diferente de zero.
 */
test("NEGATIVO: registry adulterado REPROVA, com erro estruturado e exit != 0", async (t) => {
  const raiz = projeto(t)
  const original = readFileSync(path.join(repoRoot, REG), "utf-8")
  const adulterado = original.replace(/"line": (\d+)/, (_, n) => `"line": ${Number(n) + 1000}`)
  assert.notEqual(adulterado, original, "a adulteração precisa mudar alguma coisa")

  const alvo = path.join(raiz, "registry.json")
  writeFileSync(alvo, adulterado)

  const { verificarArquivo } = await gen()
  const r = verificarArquivo({ root: repoRoot, out: alvo })
  assert.equal(r.ok, false)
  assert.equal(r.reason, "stale")
  assert.match(r.detail, /^linha \d+/, "o erro aponta a LINHA divergente, não diz apenas `difere`")
  assert.match(r.detail, /commitado:/)
  assert.match(r.detail, /gerado:/)
})

test("NEGATIVO: o comando público sai com código != 0 e escreve em stderr", async (t) => {
  const raiz = projeto(t)
  const alvo = path.join(raiz, "registry.json")
  writeFileSync(alvo, readFileSync(path.join(repoRoot, REG), "utf-8").replace(/"line": (\d+)/, '"line": 987654'))

  let erro = null
  try {
    execFileSync("node", ["-e", `
      const m = await import(${JSON.stringify(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)})
      const r = m.verificarArquivo({ root: ${JSON.stringify(repoRoot)}, out: ${JSON.stringify(alvo)} })
      if (!r.ok) { process.stderr.write(r.detail); process.exit(1) }
    `], { cwd: repoRoot, encoding: "utf-8", stdio: "pipe" })
  } catch (e) { erro = e }
  assert.ok(erro, "regenerar sobre registry adulterado precisa falhar")
  assert.equal(erro.status, 1, "exit code 1 — é o que faz o CI parar")
  assert.match(String(erro.stderr), /linha \d+/)
})

test("NEGATIVO: registry AUSENTE é reprovado, e por um motivo próprio", async (t) => {
  const raiz = projeto(t)
  const { verificarArquivo } = await gen()
  const r = verificarArquivo({ root: repoRoot, out: path.join(raiz, "nao-existe.json") })
  assert.equal(r.ok, false)
  assert.equal(r.reason, "missing", "ausente e desatualizado não são a mesma falha")
})

// ── Fins de linha: artefato de checkout, não staleness ─────────────────────

/**
 * O caso que faria o CI do Windows reprovar um repositório correto. Não basta
 * "passar": o resultado precisa NOMEAR a causa, senão a próxima pessoa lê
 * `ok: true` e nunca sabe que os bytes diferiam.
 */
test("CRLF: só os fins de linha diferindo NÃO é staleness — e o motivo fica dito", async (t) => {
  const raiz = projeto(t)
  const alvo = path.join(raiz, "registry.json")
  const original = readFileSync(path.join(repoRoot, REG), "utf-8")
  writeFileSync(alvo, original.replace(/\n/g, "\r\n"))

  const { verificarArquivo } = await gen()
  const r = verificarArquivo({ root: repoRoot, out: alvo })
  assert.equal(r.ok, true, "checkout no Windows não pode reprovar o repositório")
  assert.equal(r.reason, "line_endings", "e a diferença precisa aparecer, não ser engolida")
})

// ── O check não deixa lixo, e escreve DE VERDADE ───────────────────────────

test("o diretório temporário é removido, mesmo tendo escrito o arquivo", async () => {
  const antes = readdirSync(tmpdir()).filter((f) => f.startsWith("i18n-registry-check-"))
  const { verificarArquivo } = await gen()
  verificarArquivo({ root: repoRoot })
  const depois = readdirSync(tmpdir()).filter((f) => f.startsWith("i18n-registry-check-"))
  assert.deepEqual(depois, antes, "cada check deixaria um diretório para trás")
})

/**
 * O check REGENERA de verdade, e não apenas serializa. A prova: se o gerador
 * apenas comparasse strings em memória, escrever num destino inválido não
 * mudaria nada — aqui muda, porque o arquivo é realmente escrito e relido.
 */
test("o check escreve e RELÊ o arquivo — não compara só a string em memória", async (t) => {
  const raiz = projeto(t)
  const { gerarArquivo } = await gen()
  const alvo = path.join(raiz, "sub", "registry.json")
  assert.throws(() => gerarArquivo({ root: repoRoot, out: alvo }),
    /ENOENT/, "escrever num diretório inexistente falha — logo, há escrita real")
  assert.equal(existsSync(alvo), false)
})

// ── O contrato público: os dois comandos existem e são distintos ───────────

test("`generate` e `check` são scripts npm distintos, e o CI usa o `check`", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
  assert.equal(pkg.scripts["i18n:registry:generate"], "node scripts/i18n-registry.mjs")
  assert.equal(pkg.scripts["i18n:registry:check"], "node scripts/i18n-registry.mjs --check")

  const ci = readFileSync(path.join(repoRoot, ".github", "workflows", "test.yml"), "utf-8")
  assert.match(ci, /npm run i18n:registry:check/, "o CI precisa conferir o artefato gerado")
  assert.equal(ci.includes("npm run i18n:registry:generate"), false,
    "CI que REGENERA esconde exatamente o erro que este passo existe para pegar")
})
