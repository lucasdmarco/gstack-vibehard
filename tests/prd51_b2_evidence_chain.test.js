import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PRD51_RC_ITEMS } from "../src/dream/rc-checklist-prd51.js"
import { escreverRecibo, ancoraDeCommit } from "../scripts/test-runtime-matrix.mjs"

/**
 * CADEIA DE EVIDÊNCIA da Trilha B2 (matriz de runtime Node 18/20/22/24).
 *
 * A rodada autoritativa mediu o produto corretamente, mas a evidência ficou
 * inconsumível por dois motivos independentes:
 *
 *  1. o recibo JSON chegou ao disco por redirecionamento do PowerShell e ganhou
 *     BOM (`EF BB BF`), o que faz `JSON.parse` lançar. Evidência ilegível por
 *     máquina é pior que ausente: parece presente;
 *  2. o recibo não carregava o commit — ele existia apenas na prosa do Markdown,
 *     de modo que nada ligava, por hash, o que foi medido ao que foi versionado.
 *
 * Estes testes guardam o reparo. Não afirmam nada sobre suporte a Node: o
 * `P0.NODE-SUPPORT-GATE-INVALID` segue aberto e `ready` segue `false`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const lerBytes = (rel) => readFileSync(path.join(repoRoot, rel))
const sha256 = (b) => `sha256:${createHash("sha256").update(b).digest("hex")}`

const RECIBO = ".docs/RESEARCH/prd51-runtime-matrix-20260805.receipt.json"
const ANCORA = ".docs/RESEARCH/prd51-runtime-matrix-20260805.anchor.json"
const MATRIZ = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID").runtimeMatrix

const recibo = () => JSON.parse(lerBytes(RECIBO).toString("utf-8"))
const ancora = () => JSON.parse(lerBytes(ANCORA).toString("utf-8"))

// ── Legibilidade por máquina ────────────────────────────────────────────────

test("recibo e âncora estão versionados, sem BOM e parseiam INTEGRALMENTE", () => {
  for (const rel of [RECIBO, ANCORA]) {
    assert.ok(existsSync(path.join(repoRoot, rel)), `${rel} precisa estar versionado`)
    const bytes = lerBytes(rel)
    assert.notEqual(bytes[0], 0xef, `${rel} começa com BOM — JSON.parse lançaria`)
    assert.doesNotThrow(() => JSON.parse(bytes.toString("utf-8")), `${rel} precisa parsear inteiro`)
  }
})

test("CONTROLE: BOM na frente do recibo REALMENTE quebra o parse", () => {
  // Sem este controle, a asserção acima poderia estar guardando um problema
  // inexistente — e ninguém saberia por que o campo importa.
  const comBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), lerBytes(RECIBO)])
  assert.throws(() => JSON.parse(comBom.toString("utf-8")), /JSON/i)
})

test("CONTROLE: `escreverRecibo` recusa emitir BOM", () => {
  const alvo = path.join(process.env.TEMP ?? "/tmp", `recibo-${process.pid}.json`)
  escreverRecibo(alvo, { schemaVersion: "teste", n: 1 })
  const bytes = readFileSync(alvo)
  assert.notEqual(bytes[0], 0xef, "a escrita direta é justamente o que remove o redirect do caminho")
  assert.deepEqual(JSON.parse(bytes.toString("utf-8")), { schemaVersion: "teste", n: 1 })
})

/**
 * O hash da âncora identifica o ARQUIVO, então ele precisa sobreviver a clone e
 * checkout em qualquer plataforma.
 *
 * `core.autocrlf=true` normaliza LF no blob e reexpande CRLF no checkout Windows.
 * Para código isso é inofensivo; aqui era fatal: o recibo tinha `cc148ce3…` neste
 * Windows e `fcf627de…` no blob, de modo que a MESMA evidência intacta acusaria
 * adulteração num clone Linux. `.gitattributes` desliga a conversão nesses
 * caminhos, e este teste guarda a igualdade que torna a âncora portátil.
 */
test("os artefatos de evidência atravessam o Git byte a byte", () => {
  const atributos = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8")
  for (const rel of [RECIBO, ANCORA]) {
    const noIndice = execFileSync("git", ["hash-object", rel], { cwd: repoRoot, encoding: "utf-8" }).trim()
    const semFiltro = execFileSync("git", ["hash-object", "--no-filters", rel], { cwd: repoRoot, encoding: "utf-8" }).trim()
    assert.equal(noIndice, semFiltro,
      `${rel}: o Git aplicaria conversão de EOL, e o hash da âncora deixaria de bater fora do Windows`)
  }
  assert.match(atributos, /\.receipt\.json\s+-text/, "a regra precisa estar declarada, não depender de sorte de configuração")
  assert.match(atributos, /\.anchor\.json\s+-text/)
})

// ── Ancoragem por hash: recibo ↔ tarball ↔ commit ───────────────────────────

test("a âncora referencia o recibo pelo hash do arquivo versionado", () => {
  const a = ancora()
  assert.equal(a.recibo.sha256, sha256(lerBytes(RECIBO)),
    "hash desatualizado: a âncora deixou de descrever o recibo que está no repositório")
  assert.equal(a.recibo.caminho, RECIBO)
  assert.equal(a.recibo.bom, false)
})

test("o tarball medido é o mesmo em recibo, âncora e ledger", () => {
  const doRecibo = recibo().tarball.sha256
  assert.equal(ancora().tarball.sha256, doRecibo, "âncora e recibo divergem sobre o que foi medido")
  assert.equal(MATRIZ.tarballSha256, doRecibo, "o ledger cita um tarball diferente do medido")
  assert.match(doRecibo, /^sha256:[0-9a-f]{64}$/)
})

test("o commit da âncora existe no repositório e é o citado pelo ledger", () => {
  const { sha } = ancora().commit
  assert.equal(MATRIZ.commit, sha)
  const tipo = execFileSync("git", ["cat-file", "-t", sha], { cwd: repoRoot, encoding: "utf-8" }).trim()
  assert.equal(tipo, "commit", "âncora aponta para objeto que não é commit — cadeia quebrada")
})

/**
 * O elo que faltava. `npm pack` não é byte-reprodutível (o gzip carrega mtime),
 * então reempacotar e comparar o SHA-256 do `.tgz` não distinguiria "conteúdo
 * diferente" de "horário diferente". A reconciliação foi feita por conteúdo,
 * arquivo a arquivo, e o resultado precisa ser total: 1039 de 1039.
 */
test("a reconciliação tarball↔commit está registrada e é TOTAL", () => {
  const r = ancora().reconciliacao
  assert.equal(r.ok, true)
  assert.equal(r.divergentes, 0, "um único arquivo divergente já desfaz a ligação com o commit")
  assert.equal(r.ausentes, 0)
  assert.equal(r.identicos, r.arquivos, `${r.identicos}/${r.arquivos} — reconciliação parcial não ancora nada`)
  assert.ok(r.arquivos > 1000, "o tarball real tem mais de mil arquivos; um número pequeno indicaria extração parcial")
  assert.match(r.metodo, /hash-object/, "o método precisa ficar escrito para ser refutável")
  assert.ok(r.normalizadosEol > 0 && r.nota.includes("CRLF"),
    "a normalização de EOL precisa estar declarada — comparar bytes crus acusaria centenas de falsos positivos")
})

test("o runner passou a emitir a origem, para que a reconstrução não se repita", () => {
  assert.equal(ancora().commit.presenteNoRecibo, false, "o recibo v1 realmente não trazia o commit")

  const origem = ancoraDeCommit(repoRoot)
  assert.match(origem.commit, /^[0-9a-f]{40}$/, "rodadas novas precisam carregar o próprio commit")
  assert.equal(typeof origem.sujo, "boolean", "árvore suja precisa ser declarada, não omitida")

  const foraDeRepo = ancoraDeCommit(path.join(process.env.TEMP ?? "/tmp", "nao-existe-repo-algum"))
  assert.equal(foraDeRepo.commit, null, "fora de repositório, a ausência é declarada")
  assert.ok(foraDeRepo.motivo, "sem motivo, `null` pareceria um commit vazio legítimo")
})

// ── Escopo da claim: o que a evidência sustenta, e nada além ────────────────

test("as quatro versões foram medidas, com completude verificada", () => {
  const r = recibo()
  assert.equal(r.completude.ok, true)
  assert.deepEqual(r.completude.faltando, [])
  assert.equal(r.resultados.length, 4)
  for (const linha of r.resultados) {
    assert.equal(linha.verdict, "runtime_compatible")
    assert.deepEqual(linha.falhas, [], `${linha.node} tem falhas registradas`)
  }
  assert.deepEqual(r.resultados.map((l) => l.node), MATRIZ.versions.map((v) => v.node),
    "o ledger e o recibo precisam falar das MESMAS versões, na mesma ordem")
})

test("cobertura é de UM sistema operacional, e isso está escrito", () => {
  assert.equal(recibo().os_coverage, "windows_local")
  assert.equal(MATRIZ.os_coverage, "windows_local")
  assert.match(MATRIZ.cross_os, /unproven/, "Linux e macOS seguem sem prova")
})

/**
 * A instrução é explícita: o recibo prova `runtime_compatibility` e MAIS NADA.
 * Inflar as outras duas claims foi exatamente o erro que originou o P0.
 */
test("as três claims permanecem no escopo medido — nenhuma inflada", () => {
  const esperado = {
    runtime_compatibility: "proved_windows_local",
    suite_compatibility: "failing",
    safe_support: "undecided",
  }
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")
  assert.deepEqual({ ...item.claims }, esperado, "claims do ledger saíram do escopo medido")
  assert.deepEqual({ ...ancora().claims }, esperado, "a âncora não pode prometer mais que o ledger")
})

test("a âncora declara por escrito o que NÃO prova", () => {
  const a = ancora()
  assert.ok(a.naoProva.length >= 3)
  const texto = a.naoProva.join(" ")
  for (const re of [/su[íi]te/i, /Linux|macOS/, /decis[ãa]o humana/i]) {
    assert.match(texto, re, `limite ausente da lista de não-provas: ${re}`)
  }
})

test("o P0 segue ABERTO e a evidência não declara release pronto", () => {
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")
  assert.notEqual(item.status, "delivered", "medir compatibilidade não fecha decisão de política")
  const a = ancora()
  assert.equal(a.releaseReady, false)
  assert.equal(a.p0.estado, "aberto")
  assert.match(a.p0.fechaCom, /decis[ãa]o humana/i)
})

test("o Markdown, o recibo e o ledger contam a MESMA história de backend", () => {
  const md = readFileSync(path.join(repoRoot, ".docs/RESEARCH/prd51-runtime-matrix-20260805.md"), "utf8")
  for (const linha of recibo().resultados) {
    assert.ok(md.includes(linha.node), `${linha.node} não aparece no relatório em Markdown`)
    const noLedger = MATRIZ.versions.find((v) => v.node === linha.node)
    assert.equal(noLedger.backend, linha.backend_observado, `${linha.node}: backend do ledger diverge do medido`)
    assert.equal(noLedger.sqlite_available, linha.sqlite_available,
      `${linha.node}: capacidade OBSERVADA diverge — o backend é decidido por detecção, nunca pelo número da versão`)
  }
})
