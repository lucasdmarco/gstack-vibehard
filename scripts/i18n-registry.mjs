/**
 * Gerador do registry de saida JS — BUILD-TIME. Fatia 2 da Fase 1B.
 *
 * O engine (`scripts/lib/i18n-js-ast.mjs`) usa o compilador TypeScript, que e
 * devDependency. Se `src/meta/i18n-inventory.js` o importasse, o CLI passaria a
 * exigir TypeScript em producao so para classificar mensagens. Este gerador
 * roda em build-time e emite um JSON INERTE; o runtime le dado, nunca AST.
 *
 * SEPARACAO OBRIGATORIA entre gerado e humano:
 *
 *   src/meta/i18n-js-registry.json    100% GERADO — sobrescrito a cada run
 *   src/meta/i18n-js-overrides.json   100% HUMANO — este gerador NUNCA o abre
 *
 * Decisao humana escrita no arquivo gerado seria apagada na proxima regeneracao,
 * silenciosamente. Por isso sao dois arquivos, e por isso o gerador nao tem
 * sequer codigo que leia o de overrides.
 *
 * ESCOPO DESTA FATIA: gerar. Nao ha consumo — `buildInventory` continua no
 * extrator regex, e `convertedFiles` nasce VAZIO. Declarar um arquivo como
 * convertido exige reconciliar as classificacoes antigas com as novas, que e o
 * trabalho da Fatia 5. Gerar hoje o registry dos 332 arquivos cristalizaria
 * ~1784 classificacoes sem reconciliacao alguma.
 */
import { readFileSync, writeFileSync } from "fs"
import { createHash } from "crypto"
import path from "path"
import { analyzeFile, createAnalyzer, argumentProvenance } from "./lib/i18n-js-ast.mjs"

export const REGISTRY_SCHEMA = "gstack.i18n-js-registry.v1"
export const OVERRIDES_SCHEMA = "gstack.i18n-js-overrides.v1"

/**
 * Arquivos cujo inventario passa a vir do AST.
 *
 * `src/cli/index.js` entrou na Fatia 5, depois da reconciliacao linha a linha
 * entre o extrator regex e o AST. Os seis pontos de diferenca sao TODOS falsos
 * positivos do regex, e todos do mesmo padrao `\b(info|warn|error|...)\s*\(`:
 *
 *   270, 274, 278, 282, 286 — a DECLARACAO `export function success(msg) {`
 *                             casa o padrao e vira "chamada"
 *   305                     — o `error(` DENTRO de `console.error(` casa de novo,
 *                             duplicando um ponto ja contado como `console`
 *
 * Nenhum ponto real foi perdido: 35 do regex = 29 reais + 6 falsos.
 */
export const CONVERTED_FILES = Object.freeze([
  "src/cli/index.js", "src/commands/monitor.js", "src/cli/create.js",
  // Lote JS, arquivo 1/14. Os dois pontos de maquina (`qa.js:29` e `qa.js:44`)
  // so saem de `unknown` porque `qa --json` ganhou consumidor REAL declarado na
  // ancora fina — ver tests/qa_json_contract.test.js.
  "src/commands/qa.js",
])

const norm = (p) => String(p).replace(/\\/g, "/")

/**
 * Hash do conteudo com fins de linha NORMALIZADOS.
 *
 * Hash do buffer cru dependeria do checkout: com `core.autocrlf` no Windows o
 * mesmo commit produz bytes diferentes do Linux, e o check de frescor da Fatia 6
 * reprovaria em CI por uma diferenca que nao e de conteudo. Normalizar mantem a
 * deteccao de qualquer alteracao real e elimina o falso positivo de plataforma.
 */
export function hashConteudo(texto) {
  const normalizado = String(texto).replace(/\r\n/g, "\n")
  return `sha256:${createHash("sha256").update(normalizado, "utf8").digest("hex")}`
}

/** Marcador de origem fora do projeto — estavel entre maquinas. */
export const ORIGEM_EXTERNA = "<external>"

/**
 * Caminho relativo ao root, com barras normais.
 *
 * Uma declaracao pode resolver FORA do root: um tipo de `node_modules`, ou um
 * lib.d.ts do proprio TypeScript. A versao anterior prometia `null` no
 * comentario e devolvia o caminho ABSOLUTO no codigo — o que gravaria
 * `C:/Users/<nome>/...` no artefato commitado, quebrando determinismo entre
 * maquinas e expondo o nome de usuario de quem gerou.
 *
 * Origem em `node_modules` vira caminho relativo a partir dele (estavel e
 * informativo); qualquer outra origem externa vira `<external>`.
 */
export function origemDeBinding(alvo, root) {
  if (!alvo) return null
  const rel = path.relative(root, alvo)
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return norm(rel)
  const dentroDeModules = norm(alvo).match(/(?:^|\/)(node_modules\/.+)$/)
  return dentroDeModules ? dentroDeModules[1] : ORIGEM_EXTERNA
}

/** Entrada do registry a partir de um ponto do engine. */
function entrada(p, root) {
  const prov = argumentProvenance(p)
  return {
    audience: p.audience,
    bindingKind: p.binding.kind,
    bindingOrigin: origemDeBinding(p.binding.declaredIn, root),
    callee: p.callee,
    calleePath: p.calleePath,
    canonicalName: p.canonicalName,
    column: p.column,
    line: p.line,
    provenance: { ids: prov.ids, kind: prov.kind, resolved: prov.resolved },
    rule: p.rule,
    sink: p.sink,
  }
}

/**
 * Ordem estavel e TOTAL: linha, coluna, caminho do callee.
 *
 * So `line` nao desempata duas chamadas na mesma linha, e ordem instavel entre
 * empates faria o check byte a byte da Fatia 6 acusar diff sem que nada tenha
 * mudado.
 */
const porPosicao = (a, b) => a.line - b.line
  || a.column - b.column
  || a.calleePath.localeCompare(b.calleePath)

/**
 * Reconstroi objetos com chaves ORDENADAS, recursivamente.
 *
 * Sem isso, a ordem de insercao vaza para o JSON e duas geracoes do mesmo estado
 * produzem bytes diferentes — o check byte a byte da Fatia 6 viraria ruido.
 */
export function ordenarChaves(v) {
  if (Array.isArray(v)) return v.map(ordenarChaves)
  if (v === null || typeof v !== "object") return v
  const saida = {}
  for (const k of Object.keys(v).sort()) saida[k] = ordenarChaves(v[k])
  return saida
}

/**
 * Monta o registry para a lista de arquivos convertidos.
 *
 * Arquivo com ZERO pontos entra em `files` mesmo assim, com `entries: []`. Sem
 * isso o consumidor nao distingue "arquivo migrado que nao tem saida" de
 * "arquivo que o gerador esqueceu" — e trataria omissao como conversao.
 */
/**
 * Canonicaliza a lista de convertidos UMA VEZ e recusa o que nao pode entrar.
 *
 * Motivos de recusa, todos com o mesmo efeito se passassem: o registry deixaria
 * de ser reproduzivel ou descreveria arquivo que nao e do projeto.
 *
 *   absoluto    — grava `C:/Users/<nome>/...` na chave; muda por maquina
 *   com `../`   — aponta para fora do projeto
 *   duplicado   — `convertedFiles` e `Object.keys(files)` divergiriam, porque a
 *                 lista tem repeticao e o objeto colapsa a chave
 *
 * Falha ALTO E CEDO, com a lista completa de problemas: gerar um registry meio
 * certo e pior que nao gerar, porque ele parece valido.
 */
/** Recusa o caminho, ou devolve `null` quando ele e aceitavel. */
function motivoDeRecusa(original, rel, root) {
  if (path.isAbsolute(original)) return `caminho absoluto: ${norm(original)}`
  if (rel.startsWith("../") || rel === "..") return `fora do root: ${rel}`
  const deVolta = path.relative(root, path.resolve(root, rel))
  if (deVolta.startsWith("..") || path.isAbsolute(deVolta)) return `resolve fora do root: ${rel}`
  return null
}

/** Forma canonica da chave: normalizada, com barras normais, sem `./` inicial. */
const chaveDe = (original) => norm(path.normalize(original)).replace(/^\.\//, "")

export function canonicalizarConvertidos(arquivos, root) {
  const problemas = []
  const vistos = new Map()

  for (const bruto of arquivos) {
    const original = String(bruto)
    const rel = chaveDe(original)
    const recusa = motivoDeRecusa(original, rel, root) ?? (vistos.has(rel) ? `duplicado: ${rel}` : null)
    if (recusa) problemas.push(recusa)
    else vistos.set(rel, path.resolve(root, rel))
  }

  if (problemas.length > 0) {
    throw new Error(`i18n-registry: lista de convertidos invalida:\n  - ${problemas.join("\n  - ")}`)
  }
  return [...vistos.entries()]
    .map(([rel, abs]) => ({ rel, abs }))
    .sort((a, b) => a.rel.localeCompare(b.rel))
}

export function buildRegistry(arquivos, opcoes = {}) {
  const root = opcoes.root ?? process.cwd()
  const alvos = canonicalizarConvertidos(arquivos, root)
  const analyzer = alvos.length > 0 ? createAnalyzer(alvos.map((a) => a.abs)) : null

  const files = {}
  for (const { rel, abs } of alvos) {
    files[rel] = {
      entries: analyzeFile(abs, analyzer, { repoRoot: root }).map((p) => entrada(p, root)).sort(porPosicao),
      fileHash: hashConteudo(readFileSync(abs, "utf8")),
    }
  }

  // Invariante estrutural: a lista declarada e as chaves geradas sao a MESMA
  // coisa vista de dois angulos. Divergir significaria anunciar conversao de um
  // arquivo ausente do registry, ou o contrario.
  const convertedFiles = alvos.map((a) => a.rel)
  const chaves = Object.keys(files).sort()
  if (convertedFiles.join("\u0000") !== chaves.join("\u0000")) {
    throw new Error(`i18n-registry: convertedFiles divergiu das chaves de files:\n  lista: ${convertedFiles}\n  chaves: ${chaves}`)
  }

  return ordenarChaves({ convertedFiles, files, schema: REGISTRY_SCHEMA })
}

/** Serializacao canonica: 2 espacos e newline final. Deve ser byte-identica. */
export const serializar = (registry) => `${JSON.stringify(registry, null, 2)}\n`

export const REGISTRY_PATH = "src/meta/i18n-js-registry.json"
export const OVERRIDES_PATH = "src/meta/i18n-js-overrides.json"

export function gerarArquivo(opcoes = {}) {
  const root = opcoes.root ?? process.cwd()
  const registry = buildRegistry(opcoes.files ?? CONVERTED_FILES, { root })
  const destino = path.join(root, opcoes.out ?? REGISTRY_PATH)
  writeFileSync(destino, serializar(registry))
  return { destino, registry }
}

const executadoDiretamente = process.argv[1]
  && norm(process.argv[1]).endsWith("scripts/i18n-registry.mjs")

if (executadoDiretamente) {
  const { destino, registry } = gerarArquivo()
  const total = Object.values(registry.files).reduce((n, f) => n + f.entries.length, 0)
  process.stdout.write(
    `i18n-registry: ${registry.convertedFiles.length} arquivo(s) convertido(s), ${total} ponto(s) -> ${norm(destino)}\n`,
  )
}
