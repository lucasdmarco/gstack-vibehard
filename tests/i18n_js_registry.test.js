import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const gen = () => import(`${pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs"))}?t=${Date.now()}`)

/** Travessia compativel com Node 18 — `fs.globSync` so existe do Node 22 em diante. */
function varrerJs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return varrerJs(p)
    return e.name.endsWith(".js") ? [p] : []
  })
}

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

// ── Fatia 2.1: entradas invalidas sao RECUSADAS ──────────────────────────────

/**
 * Cada rejeicao abaixo impede um registry que PARECE valido e nao e. Sem elas o
 * gerador aceitaria descrever arquivo de fora do projeto, ou emitir chave que
 * muda de maquina para maquina.
 */

test("NEGATIVO: caminho ABSOLUTO e recusado", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("oi")\n` })
  try {
    assert.throws(
      () => buildRegistry([path.join(root, "src/commands/x.js")], { root }),
      /caminho absoluto/,
      "chave absoluta gravaria o nome de usuario e mudaria por maquina",
    )
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: caminho com `../` e recusado", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({})
  try {
    assert.throws(() => buildRegistry(["../fora.js"], { root }), /fora do root/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: `../` DISFARCADO no meio do caminho tambem e recusado", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({})
  try {
    // Normaliza para `../fora.js`: recusar so pelo prefixo textual deixaria passar.
    assert.throws(() => buildRegistry(["src/../../fora.js"], { root }), /fora do root/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: duplicata e recusada", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("oi")\n` })
  try {
    assert.throws(
      () => buildRegistry(["src/commands/x.js", "src/commands/x.js"], { root }),
      /duplicado/,
      "a lista teria 2 itens e `files` teria 1 chave — a invariante quebraria",
    )
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: duplicata DISFARCADA por `./` tambem e recusada", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("oi")\n` })
  try {
    assert.throws(
      () => buildRegistry(["src/commands/x.js", "./src/commands/x.js"], { root }),
      /duplicado/,
      "canonicalizar ANTES de comparar e o que pega este caso",
    )
  } finally { cleanupTmp(root) }
})

test("a mensagem de erro lista TODOS os problemas, nao so o primeiro", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({})
  try {
    buildRegistry(["../a.js", "../b.js"], { root })
    assert.fail("deveria ter lancado")
  } catch (e) {
    assert.match(e.message, /a\.js/)
    assert.match(e.message, /b\.js/, "corrigir um por vez seria trabalho repetido")
  }
})

test("INVARIANTE: convertedFiles === Object.keys(files).sort(), sempre", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({
    "src/commands/z.js": `import { info } from "../cli/index.js"\ninfo("z")\n`,
    "src/commands/a.js": `import { info } from "../cli/index.js"\ninfo("a")\n`,
    "src/util/puro.js": `export const x = 1\n`,
  })
  try {
    for (const lista of [
      ["src/commands/z.js", "src/commands/a.js", "src/util/puro.js"],
      ["src/util/puro.js", "src/commands/z.js", "src/commands/a.js"],
      ["./src/commands/a.js", "src/util/puro.js", "src/commands/z.js"],
      [],
    ]) {
      const r = buildRegistry(lista, { root })
      assert.deepEqual(r.convertedFiles, Object.keys(r.files).sort(),
        `divergiu para a lista ${JSON.stringify(lista)}`)
    }
  } finally { cleanupTmp(root) }
})

// ── Fatia 2.1: bindingOrigin nunca absoluto ──────────────────────────────────

test("bindingOrigin de origem EXTERNA nao vaza caminho absoluto", async () => {
  const { origemDeBinding, ORIGEM_EXTERNA } = await gen()
  const root = "C:/projeto"
  assert.equal(origemDeBinding("C:/projeto/src/cli/index.js", root), "src/cli/index.js")
  assert.equal(origemDeBinding("C:/Users/alguem/AppData/lib.d.ts", root), ORIGEM_EXTERNA,
    "o comentario prometia null e o codigo devolvia o caminho absoluto")
  assert.equal(origemDeBinding("C:/qualquer/node_modules/typescript/lib/lib.d.ts", root),
    "node_modules/typescript/lib/lib.d.ts", "origem em node_modules e estavel e informativa")
  assert.equal(origemDeBinding(null, root), null)
})

test("nenhum bindingOrigin do registry contem caminho absoluto, nem em arquivo real", async () => {
  const { buildRegistry } = await gen()
  const r = buildRegistry(["src/cli/index.js", "src/commands/monitor.js"], { root: repoRoot })
  for (const f of Object.values(r.files)) {
    for (const e of f.entries) {
      if (e.bindingOrigin === null) continue
      assert.ok(!/^[A-Za-z]:/.test(e.bindingOrigin), `absoluto: ${e.bindingOrigin}`)
      assert.ok(!e.bindingOrigin.startsWith("/"), `absoluto POSIX: ${e.bindingOrigin}`)
      assert.ok(!e.bindingOrigin.includes("Users"), `vazou caminho de usuario: ${e.bindingOrigin}`)
    }
  }
})

// ── Fatia 2.1: column identifica o callsite ──────────────────────────────────

test("duas chamadas do MESMO helper na MESMA linha viram entradas distintas", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({
    "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("a"); info("b")\n`,
  })
  try {
    const entries = buildRegistry(["src/commands/x.js"], { root }).files["src/commands/x.js"].entries
    assert.equal(entries.length, 2)
    assert.equal(entries[0].line, entries[1].line, "mesma linha")
    assert.notEqual(entries[0].column, entries[1].column,
      "so `line` faria um override atingir a chamada errada, em silencio")
    assert.ok(entries[0].column < entries[1].column, "ordenadas por coluna")
  } finally { cleanupTmp(root) }
})

test("column e 1-based e aponta para o inicio da chamada", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({ "src/commands/x.js": `import { info } from "../cli/index.js"\n  info("x")\n` })
  try {
    const e = buildRegistry(["src/commands/x.js"], { root }).files["src/commands/x.js"].entries[0]
    assert.equal(e.line, 2)
    assert.equal(e.column, 3, "duas colunas de indentacao -> comeca na 3")
  } finally { cleanupTmp(root) }
})

test("a ordenacao usa line, column e calleePath — total e estavel", async () => {
  const { buildRegistry } = await gen()
  const root = projeto({
    "src/commands/x.js": `import { info, warn } from "../cli/index.js"
warn("w"); info("i")
info("depois")
`,
  })
  try {
    const entries = buildRegistry(["src/commands/x.js"], { root }).files["src/commands/x.js"].entries
    const chaves = entries.map((e) => [e.line, e.column])
    const ordenado = [...chaves].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    assert.deepEqual(chaves, ordenado)
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

/**
 * Este teste nasceu exigindo `convertedFiles` VAZIO, para impedir que alguém
 * convertesse um arquivo antes da reconciliação. Falhou na Fatia 5, que é a
 * conversão autorizada — e agora guarda o outro lado: o que está declarado
 * precisa ter entradas de verdade.
 */
test("o registry commitado declara o que foi reconciliado, com entradas reais", async () => {
  const { REGISTRY_PATH, REGISTRY_SCHEMA } = await gen()
  const r = JSON.parse(readFileSync(path.join(repoRoot, REGISTRY_PATH), "utf8"))
  assert.equal(r.schema, REGISTRY_SCHEMA)
  // Lista DERIVADA da fonte única: ela cresce a cada arquivo do lote JS, e
  // recopiá-la aqui faria toda conversão quebrar um teste que não fala sobre ela.
  // O artefato sai ordenado alfabeticamente — não na ordem de inserção.
  const { CONVERTED_FILES } = await gen()
  assert.deepEqual(r.convertedFiles, [...CONVERTED_FILES].sort(),
    "o artefato commitado declara exatamente o que a fonte única declara")
  assert.deepEqual(Object.keys(r.files).sort(), r.convertedFiles)
  // Vale para TODO declarado, não só o primeiro: declarar sem entradas é anúncio vazio.
  for (const f of r.convertedFiles) {
    assert.ok(r.files[f].entries.length > 0, `${f} declarado sem entradas seria anúncio vazio`)
  }
})

test("o overrides commitado e EXCEPCIONAL e traz o contrato de cada override", async () => {
  const { OVERRIDES_PATH, OVERRIDES_SCHEMA } = await gen()
  const o = JSON.parse(readFileSync(path.join(repoRoot, OVERRIDES_PATH), "utf8"))
  assert.equal(o.schema, OVERRIDES_SCHEMA)

  // Ficou vazio durante todo o lote, e o primeiro so entrou quando uma decisao
  // ARQUITETURAL o exigiu: `context.js:201` imprime um trecho de documento do
  // usuario, e nenhuma regra estrutural pode decidir de QUEM e o conteudo. O
  // numero e pequeno de proposito — se crescer sem cerimonia, o mecanismo virou
  // atalho.
  assert.equal(o.overrides.length, 1, "override e excecao, e cada um precisa de razao propria")
  const [ov] = o.overrides
  assert.equal(ov.file, "src/commands/context.js")
  assert.equal(ov.audience, "user_content")
  for (const campo of ["reason", "owner", "evidence", "expectedFileHash", "line", "column"]) {
    assert.ok(ov[campo] !== undefined && String(ov[campo]).trim() !== "", `o override precisa declarar \`${campo}\``)
  }
  const doc = o.$comment.join(" ")
  for (const campo of ["file", "line", "column", "reason", "owner", "evidence", "expectedFileHash"]) {
    assert.ok(doc.includes(campo), `o contrato precisa citar \`${campo}\``)
  }
  assert.ok(/line.*NAO identifica|NAO identifica.*chamada/s.test(doc),
    "o contrato precisa dizer POR QUE a coluna e obrigatoria")
})

test("a ancora do override existe de fato nas entradas do registry", async () => {
  // O contrato dos overrides so vale se os campos que ele exige existirem no
  // dado que ele sobrescreve. Sem este teste, o contrato podeira citar um campo
  // que o gerador nunca emite.
  const { buildRegistry } = await gen()
  const r = buildRegistry(["src/cli/index.js"], { root: repoRoot })
  const e = r.files["src/cli/index.js"].entries[0]
  for (const campo of ["line", "column"]) {
    assert.ok(Number.isInteger(e[campo]) && e[campo] > 0, `entrada precisa de \`${campo}\``)
  }
  assert.match(r.files["src/cli/index.js"].fileHash, /^sha256:[0-9a-f]{64}$/)
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

/**
 * Este teste NASCEU invertido na Fatia 2: exigia que o inventário NÃO consumisse
 * o registry, para impedir que alguém ligasse o consumo antes da hora. Ele
 * cumpriu a função e falhou exatamente quando devia — na Fatia 3, que é o
 * consumo AUTORIZADO. Agora guarda o outro lado: o consumo existe e é
 * fail-closed, sem arrastar TypeScript para o runtime.
 */
test("FRONTEIRA: o inventario oficial CONSOME o registry (Fatia 3), sem TypeScript", async () => {
  const inventario = readFileSync(path.join(repoRoot, "src", "meta", "i18n-inventory.js"), "utf8")
  assert.ok(inventario.includes("i18n-js-registry-loader"),
    "a Fatia 3 ligou o consumo — se sumir, o inventario voltou ao regex sem aviso")
  assert.ok(!/from\s+["']typescript["']/.test(inventario),
    "o runtime nunca pode depender do compilador TypeScript")

  const loader = readFileSync(path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js"), "utf8")
  assert.ok(!/from\s+["']typescript["']/.test(loader))
  assert.ok(!loader.includes("i18n-js-ast"), "o engine e build-time")
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
test("GUARD ARQUITETURAL: nada em src/ importa TypeScript nem o engine AST", () => {
  // Travessia manual, e nao `fs.globSync`: `globSync` so existe a partir do
  // Node 22, o projeto declara `engines: node >=18` e o CI roda a suite em
  // Node 18 e 20. Usar a API nova aqui faria a matriz inteira de Node 18
  // reprovar por causa do TESTE, nao do codigo sob teste.
  const arquivos = varrerJs(path.join(repoRoot, "src"))
  assert.ok(arquivos.length > 100, `varredura precisa cobrir src/, veio ${arquivos.length}`)

  const infratores = []
  for (const abs of arquivos) {
    const src = readFileSync(abs, "utf8")
    const rel = path.relative(repoRoot, abs).replace(/\\/g, "/")
    if (/from\s+["']typescript["']|require\(\s*["']typescript["']\s*\)/.test(src)) {
      infratores.push(`${rel}: importa typescript`)
    }
    if (/i18n-js-ast/.test(src)) infratores.push(`${rel}: importa o engine AST`)
  }
  assert.deepEqual(infratores, [], "runtime nao pode depender de devDependency")
})
