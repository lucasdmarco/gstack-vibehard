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
 * VAZIO nesta fatia, e isso e o estado honesto: nenhum arquivo foi reconciliado
 * ainda. A Fatia 5 adiciona `src/cli/index.js` depois de confrontar os 35 pontos
 * do regex com os 29 reais e os 6 falsos positivos estruturais.
 */
export const CONVERTED_FILES = Object.freeze([])

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

/** Caminho relativo ao root, com barras normais. `null` quando fora do root. */
function relativoAoRoot(alvo, root) {
  if (!alvo) return null
  const rel = path.relative(root, alvo)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return norm(alvo)
  return norm(rel)
}

/** Entrada do registry a partir de um ponto do engine. */
function entrada(p, root) {
  const prov = argumentProvenance(p)
  return {
    audience: p.audience,
    bindingKind: p.binding.kind,
    bindingOrigin: relativoAoRoot(p.binding.declaredIn, root),
    callee: p.callee,
    calleePath: p.calleePath,
    canonicalName: p.canonicalName,
    line: p.line,
    provenance: { ids: prov.ids, kind: prov.kind, resolved: prov.resolved },
    rule: p.rule,
    sink: p.sink,
  }
}

/** Ordem estavel: por linha, e por caminho do callee quando empatam. */
const porPosicao = (a, b) => a.line - b.line || a.calleePath.localeCompare(b.calleePath)

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
export function buildRegistry(arquivos, opcoes = {}) {
  const root = opcoes.root ?? process.cwd()
  const absolutos = arquivos.map((f) => (path.isAbsolute(f) ? f : path.join(root, f)))
  const analyzer = absolutos.length > 0 ? createAnalyzer(absolutos) : null

  const files = {}
  for (const [i, abs] of absolutos.entries()) {
    const rel = norm(arquivos[i]).replace(/^\.\//, "")
    files[rel] = {
      entries: analyzeFile(abs, analyzer).map((p) => entrada(p, root)).sort(porPosicao),
      fileHash: hashConteudo(readFileSync(abs, "utf8")),
    }
  }

  return ordenarChaves({
    convertedFiles: [...arquivos].map((f) => norm(f).replace(/^\.\//, "")).sort(),
    files,
    schema: REGISTRY_SCHEMA,
  })
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
