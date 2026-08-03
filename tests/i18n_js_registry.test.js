import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Fatia 2 da Fase 1B — registry gerado.
 *
 * O artefato commitado nasce VAZIO (`convertedFiles: []`), porque declarar um
 * arquivo como convertido exige reconciliar as classificacoes antigas com as
 * novas — trabalho da Fatia 5. Como o artefato nao exercita o gerador, estes
 * testes o exercitam com projetos reais em tmp.
 *
 * O que precisa ficar provado aqui, antes de qualquer consumo existir:
 *
 *  - **Determinismo byte a byte**: sem ele o check de frescor da Fatia 6 seria
 *    ruido, e ninguem confiaria em "o registry esta desatualizado".
 *  - **Arquivo com zero pontos aparece assim mesmo**: sem isso o consumidor nao
 *    distingue "migrado e sem saida" de "o gerador esqueceu", e trataria omissao
 *    como conversao.
 *  - **`fileHash` muda quando o conteudo muda** — e NAO muda por fim de linha,
 *    senao o CI reprova no Windows por um motivo que nao e de conteudo.
 *  - **O gerador nao toca os overrides.** E o unico arquivo humano do par.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const gen = () => import(`${pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs"))}?t=${Date.now()}`)

/** Mini-projeto com modulo canonico e os arquivos pedidos. */
function projeto(files) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-reg-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, "src", "cli", "index.js"), `
export function info(msg) { console.log(msg) }
`)
  for (const [rel, src] of Object.entries(files)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, src)
  }
  return root
}

// ── Schema e forma ───────────────────────────────────────────────────────────

test("o registry declara schema versionado", async () => {
  const { buildRegistry, REGISTRY_SCHEMA } = await gen()
  const root = projeto({})
  try {
    assert.equal(buildRegistry([], { root }).schema, REGISTRY_SCHEMA)
    assert.equal(REGISTRY_SCHEMA, "gstack.i18n-js-registry.v1")
  } finally { cleanupTmp(root) }
})

test("entries carregam linha, callee, origem do binding, audiencia, regra e provenance", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("oi")\n` })
  try {
    const r = buildRegistry(["src/commands/x.js"], { root })
    const e = r.files["src/commands/x.js"].entries[0]
    assert.equal(e.line, 2)
    assert.equal(e.callee, "info")
    assert.equal(e.calleePath, "info")
    assert.equal(e.canonicalName, "info")
    assert.equal(e.bindingKind, "import")
    assert.equal(e.bindingOrigin, "src/cli/index.js", "origem RELATIVA ao root, nunca absoluta")
    assert.equal(e.audience, "public_diagnostic")
    assert.equal(e.rule, "render-via-canonical-helper")
    assert.deepEqual(e.provenance, { ids: [], kind: "literal_only", resolved: true })
    assert.equal(e.sink, null)
  } finally { cleanupTmp(root) }
})

test("caminho absoluto de tmp NUNCA vaza para o registry", async () => {
  const { buildRegistry, serializar } = await gen()
  const root = projeto({ "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("oi")\n` })
  try {
    const texto = serializar(buildRegistry(["src/commands/x.js"], { root }))
    assert.ok(!texto.includes(root), "o registry seria diferente em cada maquina")
    assert.ok(!/[A-Za-z]:\//.test(texto), "nenhum caminho absoluto de Windows")
  } finally { cleanupTmp(root) }
})

test("sinks de stream entram no registry com sink e calleePath", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/commands/x.js": `export function run() { process.stdout.write("x") }\n` })
  try {
    const e = buildRegistry(["src/commands/x.js"], { root }).files["src/commands/x.js"].entries[0]
    assert.equal(e.sink, "stdout")
    assert.equal(e.calleePath, "process.stdout.write")
    assert.equal(e.audience, "unknown", "extraido e pendente, nunca ausente")
  } finally { cleanupTmp(root) }
})

// ── convertedFiles ───────────────────────────────────────────────────────────

test("arquivo com ZERO pontos aparece em convertedFiles E em files", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/util/puro.js": `export const soma = (a, b) => a + b\n` })
  try {
    const r = buildRegistry(["src/util/puro.js"], { root })
    assert.deepEqual(r.convertedFiles, ["src/util/puro.js"])
    assert.ok("src/util/puro.js" in r.files, "omitir aqui faria omissao parecer conversao")
    assert.deepEqual(r.files["src/util/puro.js"].entries, [])
    assert.match(r.files["src/util/puro.js"].fileHash, /^sha256:[0-9a-f]{64}$/)
  } finally { cleanupTmp(root) }
})

test("convertedFiles e ordenado e reflete exatamente o que foi gerado", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({
    "src/commands/z.js": `import { info } from "../cli/index.js"\ninfo("z")\n`,
    "src/commands/a.js": `import { info } from "../cli/index.js"\ninfo("a")\n`,
  })
  try {
    const r = buildRegistry(["src/commands/z.js", "src/commands/a.js"], { root })
    assert.deepEqual(r.convertedFiles, ["src/commands/a.js", "src/commands/z.js"])
    assert.deepEqual(Object.keys(r.files).sort(), ["src/commands/a.js", "src/commands/z.js"])
  } finally { cleanupTmp(root) }
})

test("arquivo NAO convertido nao aparece no registry, mesmo tendo saida", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({
    "src/commands/dentro.js": `import { info } from "../cli/index.js"\ninfo("d")\n`,
    "src/commands/fora.js": `import { info } from "../cli/index.js"\ninfo("f")\n`,
  })
  try {
    const r = buildRegistry(["src/commands/dentro.js"], { root })
    assert.deepEqual(r.convertedFiles, ["src/commands/dentro.js"])
    assert.ok(!("src/commands/fora.js" in r.files),
      "conversao e arquivo a arquivo — o resto segue no extrator legado")
  } finally { cleanupTmp(root) }
})

// ── Determinismo ─────────────────────────────────────────────────────────────

test("gerar DUAS vezes o mesmo estado produz bytes IDENTICOS", async () => {
  const { buildRegistry, serializar } = await gen()
  const root = projeto({
    "src/commands/b.js": `import { info } from "../cli/index.js"\ninfo("b")\nprocess.stdout.write("x")\n`,
    "src/commands/a.js": `import { info } from "../cli/index.js"\ninfo("a")\n`,
  })
  try {
    const um = serializar(buildRegistry(["src/commands/b.js", "src/commands/a.js"], { root }))
    const dois = serializar(buildRegistry(["src/commands/b.js", "src/commands/a.js"], { root }))
    assert.equal(um, dois)
  } finally { cleanupTmp(root) }
})

test("a ORDEM da lista de entrada nao muda um unico byte da saida", async () => {
  const { buildRegistry, serializar } = await gen()
  const root = projeto({
    "src/commands/b.js": `import { info } from "../cli/index.js"\ninfo("b")\n`,
    "src/commands/a.js": `import { info } from "../cli/index.js"\ninfo("a")\n`,
  })
  try {
    const direta = serializar(buildRegistry(["src/commands/a.js", "src/commands/b.js"], { root }))
    const inversa = serializar(buildRegistry(["src/commands/b.js", "src/commands/a.js"], { root }))
    assert.equal(direta, inversa, "ordem de insercao nao pode vazar para o JSON")
  } finally { cleanupTmp(root) }
})

test("as chaves saem ordenadas em todos os niveis", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("oi")\n` })
  try {
    const r = buildRegistry(["src/commands/x.js"], { root })
    assert.deepEqual(Object.keys(r), ["convertedFiles", "files", "schema"])
    assert.deepEqual(Object.keys(r.files["src/commands/x.js"]), ["entries", "fileHash"])
    const e = Object.keys(r.files["src/commands/x.js"].entries[0])
    assert.deepEqual(e, [...e].sort())
  } finally { cleanupTmp(root) }
})

test("entries de um mesmo arquivo saem ordenadas por linha", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({
    "src/commands/x.js": `import { info } from "../cli/index.js"
export function run() {
  process.stdout.write("a")
  info("b")
  console.log("c")
}
`,
  })
  try {
    const linhas = buildRegistry(["src/commands/x.js"], { root })
      .files["src/commands/x.js"].entries.map((e) => e.line)
    assert.deepEqual(linhas, [...linhas].sort((a, b) => a - b))
    assert.ok(linhas.length >= 3)
  } finally { cleanupTmp(root) }
})

// ── fileHash ─────────────────────────────────────────────────────────────────

test("fileHash MUDA quando o conteudo muda", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("a")\n` })
  try {
    const antes = buildRegistry(["src/commands/x.js"], { root }).files["src/commands/x.js"].fileHash
    writeFileSync(path.join(root, "src/commands/x.js"), `import { info } from "../cli/index.js"\ninfo("b")\n`)
    const depois = buildRegistry(["src/commands/x.js"], { root }).files["src/commands/x.js"].fileHash
    assert.notEqual(antes, depois, "sem isso, classificacao antiga sobreviveria em callsite novo")
  } finally { cleanupTmp(root) }
})

test("fileHash NAO muda por fim de linha — CRLF e LF dao o mesmo hash", async () => {
  const { hashConteudo } = await gen()
  const lf = "export function a() {\n  return 1\n}\n"
  assert.equal(hashConteudo(lf), hashConteudo(lf.replace(/\n/g, "\r\n")),
    "hash de buffer cru reprovaria o CI no Windows por diferenca que nao e de conteudo")
})

test("fileHash difere entre arquivos diferentes", async () => {
  const { hashConteudo } = await gen()
  assert.notEqual(hashConteudo("a"), hashConteudo("b"))
})

// ── Separacao gerado / humano ────────────────────────────────────────────────

test("o gerador NAO escreve nem le o arquivo de overrides", async () => {
  const { gerarArquivo, OVERRIDES_PATH } = await gen()
  const root = projeto({})
  try {
    mkdirSync(path.join(root, "src", "meta"), { recursive: true })
    const overrides = path.join(root, OVERRIDES_PATH)
    const conteudo = `{ "schema": "gstack.i18n-js-overrides.v1", "overrides": [] }\n`
    writeFileSync(overrides, conteudo)
    const antes = statSync(overrides).mtimeMs

    gerarArquivo({ root, files: [] })

    assert.equal(readFileSync(overrides, "utf8"), conteudo, "conteudo intacto")
    assert.equal(statSync(overrides).mtimeMs, antes, "nem sequer foi tocado")
  } finally { cleanupTmp(root) }
})

test("o codigo do gerador nao menciona o caminho de overrides fora da constante", async () => {
  // Controle estrutural: se um dia alguem fizer o gerador escrever decisao
  // humana no arquivo gerado, ou vice-versa, a separacao morre em silencio.
  const fonte = readFileSync(path.join(repoRoot, "scripts", "i18n-registry.mjs"), "utf8")
  const linhasCodigo = fonte.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .filter((l) => l.includes("src/meta/i18n-js-overrides.json"))
  assert.equal(linhasCodigo.length, 1, "so a constante OVERRIDES_PATH pode citar o CAMINHO")
  assert.match(linhasCodigo[0], /OVERRIDES_PATH\s*=/)

  // E o caminho existe apenas como constante exportada: nenhuma operacao de IO
  // do gerador pode aceita-lo como destino.
  assert.ok(!/(readFileSync|writeFileSync)\s*\([^)]*OVERRIDES_PATH/.test(fonte),
    "nenhuma leitura ou escrita pode apontar para os overrides")
})

// ── Artefatos commitados ─────────────────────────────────────────────────────

test("o registry commitado esta VAZIO e declara isso explicitamente", async () => {
  const { REGISTRY_PATH, REGISTRY_SCHEMA } = await gen()
  const r = JSON.parse(readFileSync(path.join(repoRoot, REGISTRY_PATH), "utf8"))
  assert.equal(r.schema, REGISTRY_SCHEMA)
  assert.deepEqual(r.convertedFiles, [], "nenhum arquivo foi reconciliado ainda — Fatia 5")
  assert.deepEqual(r.files, {})
})

test("o overrides commitado esta vazio e traz o contrato de cada override", async () => {
  const { OVERRIDES_PATH, OVERRIDES_SCHEMA } = await gen()
  const o = JSON.parse(readFileSync(path.join(repoRoot, OVERRIDES_PATH), "utf8"))
  assert.equal(o.schema, OVERRIDES_SCHEMA)
  assert.deepEqual(o.overrides, [])
  const doc = o.$comment.join(" ")
  for (const campo of ["reason", "owner", "evidence", "expectedFileHash"]) {
    assert.ok(doc.includes(campo), `o contrato precisa citar \`${campo}\``)
  }
})

test("regenerar o artefato commitado nao produz diff", async () => {
  const { buildRegistry, serializar, CONVERTED_FILES, REGISTRY_PATH } = await gen()
  const emDisco = readFileSync(path.join(repoRoot, REGISTRY_PATH), "utf8").replace(/\r\n/g, "\n")
  const regerado = serializar(buildRegistry([...CONVERTED_FILES], { root: repoRoot }))
  assert.equal(regerado, emDisco, "o arquivo commitado precisa ser exatamente o que o gerador emite")
})

/**
 * Os testes de determinismo acima usam fixtures pequenos, e o artefato commitado
 * esta vazio — nenhum dos dois exercita o gerador contra codigo REAL. Este roda
 * sobre arquivos do proprio repositorio, com dezenas de pontos, sem declarar
 * nenhum deles convertido: gerar nao e converter.
 */
test("determinismo e forma valem tambem sobre arquivos REAIS do repositorio", async () => {
  const { buildRegistry, serializar } = await gen()
  const alvos = ["src/cli/index.js", "src/commands/monitor.js"]

  const um = serializar(buildRegistry(alvos, { root: repoRoot }))
  const dois = serializar(buildRegistry([...alvos].reverse(), { root: repoRoot }))
  assert.equal(um, dois, "bytes identicos, inclusive com a lista invertida")

  const r = JSON.parse(um)
  const pontos = alvos.flatMap((f) => r.files[f].entries)
  assert.ok(pontos.length > 20, `esperado volume real, veio ${pontos.length}`)
  assert.ok(pontos.some((e) => e.sink !== null), "os sinks de stream chegam ao registry")
  assert.ok(!um.includes(repoRoot.replace(/\\/g, "/")), "nenhum caminho absoluto")

  for (const e of pontos) {
    assert.ok(Number.isInteger(e.line) && e.line > 0)
    assert.ok(typeof e.audience === "string" && e.audience.length > 0)
    assert.ok("rule" in e && "provenance" in e && "bindingOrigin" in e)
  }
})

// ── Fronteira com a Fatia 3 ──────────────────────────────────────────────────

test("FRONTEIRA: o inventario oficial ainda NAO consome o registry", async () => {
  // A Fatia 2 gera; quem consome e a Fatia 3. Se este teste comecar a falhar
  // sem que a Fatia 3 tenha sido feita, alguem ligou o registry adiantado.
  const inventario = readFileSync(path.join(repoRoot, "src", "meta", "i18n-inventory.js"), "utf8")
  assert.ok(!inventario.includes("i18n-js-registry"),
    "consumo do registry pertence a Fatia 3")
})

/**
 * A razao de o engine viver em `scripts/lib/` e nao em `src/` e uma so: ele
 * importa o compilador TypeScript, que e devDependency. `npm pack` inclui
 * `scripts/`, entao o arquivo VIAJA no tarball — inerte, porque ninguem em
 * runtime o importa. Se algum dia alguem importar, a instalacao do usuario final
 * quebra por falta de um pacote que so existe em desenvolvimento, e o erro
 * aparece na maquina dele, nao aqui.
 *
 * A prova de instalacao sem devDependencies e da Fatia 7; este guard e o que
 * impede a regressao chegar la.
 */
test("GUARD ARQUITETURAL: nada em src/ importa TypeScript nem o engine AST", async () => {
  const { globSync } = await import("node:fs")
  const anterior = process.cwd()
  process.chdir(repoRoot)
  try {
    const arquivos = globSync("src/**/*.js")
    assert.ok(arquivos.length > 100, `varredura precisa cobrir src/, veio ${arquivos.length}`)

    const infratores = []
    for (const f of arquivos) {
      const src = readFileSync(path.join(repoRoot, f), "utf8")
      if (/from\s+["']typescript["']|require\(\s*["']typescript["']\s*\)/.test(src)) {
        infratores.push(`${f}: importa typescript`)
      }
      if (/i18n-js-ast/.test(src)) infratores.push(`${f}: importa o engine AST`)
    }
    assert.deepEqual(infratores, [], "runtime nao pode depender de devDependency")
  } finally { process.chdir(anterior) }
})
