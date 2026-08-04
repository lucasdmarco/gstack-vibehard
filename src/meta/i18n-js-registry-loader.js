import { readFileSync, existsSync, realpathSync } from "fs"
import { join, normalize, isAbsolute, relative, sep } from "path"
import { createHash } from "crypto"
import { stripBom } from "../util/json.js"
import { AUDIENCES, OVERRIDABLE_AUDIENCES } from "./i18n-audiences.js"

/**
 * Consumo do registry AST — RUNTIME. Fatia 3 da Fase 1B.
 *
 * ZERO TypeScript. O registry é gerado em build-time por `scripts/i18n-registry.mjs`
 * (que usa o compilador TypeScript, devDependency); aqui ele é dado inerte. Se este
 * módulo importasse o engine, o CLI passaria a exigir TypeScript em produção — há
 * teste varrendo `src/**` para impedir exatamente isso.
 *
 * FAIL-CLOSED. Três modos de falha BLOQUEIAM em vez de cair no extrator legado:
 *
 *   missing  — o artefato é shipado no tarball; ausência = pacote incompleto
 *   corrupt  — JSON inválido, schema desconhecido, estrutura ou referência fora do contrato
 *   stale    — `fileHash` não confere: a classificação não descreve mais o arquivo
 *
 * Fallback silencioso para o regex seria o pior resultado: a classificação ANTIGA
 * voltaria a valer sobre código NOVO, sem aviso, e o inventário pareceria saudável.
 *
 * ERRO ESTRUTURADO, NUNCA CRASH — e isso vale para dado HOSTIL, não só para dado
 * ausente. `entries: [null]`, `overrides: 42`, arquivo convertido que é diretório
 * ou sem permissão: tudo vira veredito tipado. Exceção com stack seria
 * indistinguível de bug e perderia a razão.
 *
 * O registry é DADO DE ENTRADA e é tratado como tal: caminhos são validados contra
 * traversal antes de qualquer acesso a disco.
 */

export const REGISTRY_FILE = "src/meta/i18n-js-registry.json"
export const OVERRIDES_FILE = "src/meta/i18n-js-overrides.json"
export const REGISTRY_SCHEMA = "gstack.i18n-js-registry.v1"
export const OVERRIDES_SCHEMA = "gstack.i18n-js-overrides.v1"

const HASH_RE = /^sha256:[0-9a-f]{64}$/

/**
 * Hash com fins de linha NORMALIZADOS — precisa casar bit a bit com
 * `hashConteudo` de `scripts/i18n-registry.mjs`. Buffer cru dependeria do
 * checkout: com `core.autocrlf` o mesmo commit produz bytes diferentes entre
 * Windows e Linux, e o registry seria declarado `stale` sem nada ter mudado.
 */
export function hashFileContent(texto) {
  const normalizado = String(texto).replace(/\r\n/g, "\n")
  return `sha256:${createHash("sha256").update(normalizado, "utf8").digest("hex")}`
}

const falha = (status, reason, details = {}) => ({ ok: false, status, reason, details })

const ehObjeto = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const naoVazio = (v) => typeof v === "string" && v.trim().length > 0

// ── Caminhos: o registry é entrada, não fonte confiável ──────────────────────

/**
 * O caminho é relativo, canônico e contido em `repoRoot`?
 *
 * Sem isto, uma chave como `../../etc/passwd` faria a validação de frescor ler
 * fora do repositório. Rejeitar por prefixo textual não basta: `src/../../fora`
 * só aparece depois de normalizar.
 */
const ehTexto = (p) => typeof p === "string" && p.trim() !== ""
const ehAbsoluto = (p) => isAbsolute(p) || /^[A-Za-z]:/.test(p)
const canonicoDe = (p) => normalize(p).split(sep).join("/")
const escapa = (c) => c === ".." || c.startsWith("../")

/**
 * Ordem importa: a primeira regra recusa não-string, e as seguintes só rodam
 * depois dela — por isso podem chamar métodos de string sem checar de novo.
 */
const REGRAS_PATH = Object.freeze([
  { falha: (p) => !ehTexto(p), motivo: () => "caminho vazio ou não textual" },
  { falha: (p) => p.includes("\0"), motivo: () => "caminho com byte nulo" },
  { falha: ehAbsoluto, motivo: () => "caminho absoluto" },
  { falha: (p) => p.includes("\\"), motivo: () => "separador inválido (use `/`)" },
  { falha: (p) => canonicoDe(p) !== p, motivo: (p) => `caminho não canônico (normaliza para \`${canonicoDe(p)}\`)` },
  { falha: (p) => escapa(canonicoDe(p)), motivo: () => "caminho escapa do repositório" },
])

export function pathProblem(p) {
  for (const r of REGRAS_PATH) if (r.falha(p)) return r.motivo(p)
  return null
}

/** O caminho REAL (símbolos resolvidos) está contido no root REAL? */
const contido = (root, alvo) => {
  const volta = relative(root, alvo)
  return volta === "" || (!volta.startsWith("..") && !isAbsolute(volta))
}

/**
 * Resolve dentro do root com contenção REAL, não apenas lexical.
 *
 * `pathProblem` é sintático e não vê symlink: um link dentro do repositório
 * apontando para fora passaria nele, e `readFileSync` seguiria o alvo. Aqui o
 * `realpathSync` resolve links dos dois lados e a contenção é verificada sobre
 * os caminhos reais — symlink continua permitido, desde que o destino também
 * esteja dentro do projeto.
 */
function resolverDentro(repoRoot, p) {
  const abs = join(repoRoot, p)
  if (!contido(repoRoot, abs)) return { ok: false, reason: "caminho escapa do repositório" }
  if (!existsSync(abs)) return { ok: false, reason: "arquivo convertido não existe" }

  let rootReal, alvoReal
  try {
    rootReal = realpathSync(repoRoot)
    alvoReal = realpathSync(abs)
  } catch (e) {
    return { ok: false, reason: `caminho irresolvível: ${e.code || e.message}` }
  }
  if (!contido(rootReal, alvoReal)) {
    return { ok: false, reason: "link aponta para fora do repositório" }
  }
  return { ok: true, abs }
}

// ── Leitura tolerante a dado hostil ──────────────────────────────────────────

function lerJson(abs, rotulo) {
  if (!existsSync(abs)) return falha("missing", `${rotulo} não existe`, { file: rotulo })
  let texto
  try { texto = readFileSync(abs, "utf8") } catch (e) {
    return falha("corrupt", `${rotulo} ilegível: ${e.code || e.message}`, { file: rotulo })
  }
  try { return { ok: true, data: JSON.parse(stripBom(texto)) } } catch (e) {
    return falha("corrupt", `${rotulo} não é JSON válido: ${e.message}`, { file: rotulo })
  }
}

/**
 * Lê um arquivo convertido. Diretório (EISDIR), permissão (EACCES) e qualquer
 * outro erro de IO viram veredito — nunca exceção.
 */
function lerFonte(abs) {
  try { return { ok: true, texto: readFileSync(abs, "utf8") } } catch (e) {
    return { ok: false, code: e.code || "EIO" }
  }
}

// ── Forma ────────────────────────────────────────────────────────────────────

const inteiroPositivo = (n) => Number.isInteger(n) && n >= 1

const problemaCabecalho = (r) => {
  if (!ehObjeto(r)) return "registry não é um objeto"
  if (r.schema !== REGISTRY_SCHEMA) return `schema desconhecido: ${JSON.stringify(r.schema)}`
  if (!Array.isArray(r.convertedFiles)) return "convertedFiles ausente ou não é lista"
  if (!ehObjeto(r.files)) return "files ausente ou não é objeto"
  return null
}

const problemaListaPaths = (rotulo, lista) => {
  for (const f of lista) {
    const problema = pathProblem(f)
    if (problema) return `${rotulo}: ${problema} (${JSON.stringify(f)})`
  }
  return null
}

/**
 * `convertedFiles` e as chaves de `files` são a mesma coisa vista de dois
 * ângulos. Comparação elemento a elemento: juntar com separador exigiria um byte
 * que nunca aparece em caminho, e um NUL literal tornaria este fonte binário
 * para `rg` e afins — foi exatamente o que aconteceu numa versão anterior.
 */
const problemaCoerencia = (r) => {
  const chaves = Object.keys(r.files).sort()
  const lista = [...r.convertedFiles].sort()
  const iguais = chaves.length === lista.length && chaves.every((c, i) => c === lista[i])
  return iguais ? null : `convertedFiles diverge das chaves de files (lista=${lista.length}, chaves=${chaves.length})`
}

function validarForma(r) {
  return problemaCabecalho(r)
    || problemaListaPaths("convertedFiles", r.convertedFiles)
    || problemaListaPaths("files", Object.keys(r.files))
    || problemaCoerencia(r)
}

const problemaArquivo = (file, dados) => {
  if (!ehObjeto(dados)) return `files["${file}"] não é objeto`
  if (typeof dados.fileHash !== "string" || !HASH_RE.test(dados.fileHash)) {
    return `files["${file}"].fileHash ausente ou malformado`
  }
  if (!Array.isArray(dados.entries)) return `files["${file}"].entries não é lista`
  return null
}

/** Formas de provenance que o gerador emite. */
const PROVENANCE_KINDS = Object.freeze(["literal_only", "interpolated"])

/**
 * Provenance COMPLETA — validada aqui, e não só onde é consumida.
 *
 * `ids: 42` passava por esta camada e explodia lá adiante, em `[...ids]` dentro
 * da comparação com a decisão humana: crash em vez de veredito, violando o
 * contrato "erro estruturado, nunca crash". A validação pertence à fronteira,
 * onde o dado entra, não ao consumidor de plantão.
 */
const idsValidos = (v) => Array.isArray(v) && v.every((x) => naoVazio(x))

/**
 * As duas formas são semanticamente fechadas, e a incoerência entre elas é
 * silenciosa: `{kind:"literal_only", resolved:false}` faria um literal puro
 * bloquear para sempre, e `{kind:"interpolated", ids:[]}` faria uma decisão
 * humana passar sem identificador nenhum para conferir.
 */
const REGRAS_PROVENANCE = Object.freeze([
  { falha: (p) => !ehObjeto(p), motivo: () => "`provenance` não é objeto" },
  { falha: (p) => typeof p.resolved !== "boolean", motivo: () => "`provenance.resolved` não é booleano" },
  { falha: (p) => !PROVENANCE_KINDS.includes(p.kind), motivo: (p) => `\`provenance.kind\` inválido: ${JSON.stringify(p.kind)}` },
  { falha: (p) => !idsValidos(p.ids), motivo: () => "`provenance.ids` não é lista de strings não vazias" },
  {
    falha: (p) => p.kind === "literal_only" && (p.resolved !== true || p.ids.length > 0),
    motivo: () => "`literal_only` exige `resolved:true` e `ids` vazio",
  },
  {
    falha: (p) => p.kind === "interpolated" && (p.resolved !== false || p.ids.length === 0),
    motivo: () => "`interpolated` exige `resolved:false` e ao menos um id",
  },
])

const problemaProvenance = (file, e) => {
  const p = e.provenance
  if (p === undefined) return null                      // ausência é tratada no inventário
  const r = REGRAS_PROVENANCE.find((x) => x.falha(p))
  return r ? `${file}:${e.line} ${r.motivo(p)}` : null
}

/** `entries: [null]` chegava aqui e explodia em `e.line`. */
const problemaEntrada = (file, e, i) => {
  if (!ehObjeto(e)) return `${file}: entrada #${i} não é objeto (${JSON.stringify(e)})`
  if (!inteiroPositivo(e.line)) return `${file}: entrada #${i} sem \`line\` válida`
  if (!inteiroPositivo(e.column)) return `${file}: linha ${e.line} sem \`column\` válida`
  if (!naoVazio(e.audience)) return `${file}:${e.line} sem \`audience\``
  if (!AUDIENCES.includes(e.audience)) return `${file}:${e.line} audiência inválida: ${e.audience}`
  return problemaProvenance(file, e)
}

function validarEntradas(r) {
  for (const [file, dados] of Object.entries(r.files)) {
    const problema = problemaArquivo(file, dados)
    if (problema) return problema
    for (const [i, e] of dados.entries.entries()) {
      const daEntrada = problemaEntrada(file, e, i)
      if (daEntrada) return daEntrada
    }
  }
  return null
}

// ── Overrides: validação REFERENCIAL ─────────────────────────────────────────

const CAMPOS_OVERRIDE = ["file", "line", "column", "audience", "reason", "owner", "evidence", "expectedFileHash"]

// ── Decisões de PROVENANCE (Fatia 4.2) ───────────────────────────────────────

/**
 * Estratégias de resolução de provenance.
 *
 * `translate_literal_frame_preserve_interpolations`: a MOLDURA literal é
 * traduzível; os valores interpolados permanecem dinâmicos e NÃO são traduzidos.
 *
 * Caso real em `src/cli/index.js:304` — o helper de render recebe o template
 * "Falha ao executar '<command>': <e.message>". A moldura vira inglês; `command`
 * e `e.message` são dados de runtime.
 *
 * NOTA DE ESCRITA: o exemplo acima evita de propósito a sintaxe literal de
 * chamada. A primeira versão deste comentário a continha e o extrator REGEX do
 * inventário a contou como ponto de saída real — o total foi de 1924 para 1925
 * por causa de um COMENTÁRIO. É o mesmo falso positivo estrutural que motivou
 * esta fase inteira, e `src/meta/` ainda não está convertido para o AST.
 */
export const PROVENANCE_STRATEGIES = Object.freeze(["translate_literal_frame_preserve_interpolations"])

/**
 * Procedência do VEREDITO INTEIRO produzido por `loadJsRegistry`.
 *
 * Uma prova só, cobrindo `byFile`, `overrides` e `provenanceDecisions` — a
 * versão anterior marcava apenas as decisões de provenance e deixava a mesma
 * porta aberta para os OVERRIDES: um veredito fabricado com override ancorado
 * num callsite real reclassificava a mensagem, mudava `in_scope` para
 * `out_of_scope` e liberava o gate, sem passar por validação nenhuma.
 *
 * `WeakSet` e não `Symbol` no objeto: não há propriedade a copiar. A associação
 * vive fora do veredito, e só esta função insere — uma cópia campo a campo,
 * por mais idêntica que seja, não é reconhecida.
 */
const VEREDITOS_VALIDADOS = new WeakSet()

/** O veredito foi produzido e validado por `loadJsRegistry`? */
export const isValidatedRegistry = (v) => Boolean(v) && VEREDITOS_VALIDADOS.has(v)

const CAMPOS_DECISAO = ["file", "line", "column", "expectedFileHash", "strategy", "interpolations", "reason", "owner", "evidence"]

const mesmosIds = (a, b) => {
  const x = [...a].sort()
  const y = [...b].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

const problemaCamposDecisao = (d, i) => {
  for (const campo of CAMPOS_DECISAO) {
    if (d[campo] === undefined) return `decisão de provenance #${i} sem \`${campo}\``
  }
  for (const campo of ["reason", "owner", "evidence"]) {
    if (!naoVazio(d[campo])) return `decisão de provenance #${i}: \`${campo}\` vazio`
  }
  return null
}

const problemaFormaDecisao = (d, i) => {
  const daPath = pathProblem(d.file)
  if (daPath) return `decisão de provenance #${i}: ${daPath}`
  if (!inteiroPositivo(d.line)) return `decisão de provenance #${i}: \`line\` inválida`
  if (!inteiroPositivo(d.column)) return `decisão de provenance #${i}: \`column\` inválida`
  if (!PROVENANCE_STRATEGIES.includes(d.strategy)) {
    return `decisão de provenance #${i}: estratégia desconhecida: ${JSON.stringify(d.strategy)}`
  }
  if (!Array.isArray(d.interpolations)) return `decisão de provenance #${i}: \`interpolations\` não é lista`
  return null
}

/**
 * A decisão precisa descrever o callsite REAL, com o conteúdo que ela julgou e
 * exatamente os identificadores que o gerador extraiu.
 *
 * Divergência de identificadores é o controle mais importante: se o código ganhar
 * uma interpolação nova, a decisão humana deixa de cobrir a string inteira — e
 * aceitar isso em silêncio faria uma mensagem parcialmente não analisada passar
 * como decidida.
 */
const problemaArquivoDecisao = (d, i, alvo) => {
  if (!alvo) return `decisão de provenance #${i}: \`${d.file}\` não está em convertedFiles`
  if (!HASH_RE.test(d.expectedFileHash)) return `decisão de provenance #${i}: \`expectedFileHash\` malformado`
  if (d.expectedFileHash !== alvo.fileHash) {
    return `decisão de provenance #${i}: \`expectedFileHash\` não confere — o arquivo mudou desde a decisão`
  }
  return null
}

const problemaCallsiteDecisao = (d, i, entrada) => {
  if (!entrada) return `decisão de provenance #${i}: nenhum callsite em ${d.file}:${d.line}:${d.column}`
  if (entrada.provenance?.resolved !== false) {
    return `decisão de provenance #${i}: o callsite ${d.file}:${d.line}:${d.column} já tem provenance resolvida — decisão desnecessária`
  }
  const gerado = entrada.provenance.ids ?? []
  if (!mesmosIds(d.interpolations, gerado)) {
    return `decisão de provenance #${i}: interpolações divergem do gerado (decidido=${JSON.stringify([...d.interpolations].sort())}, gerado=${JSON.stringify([...gerado].sort())})`
  }
  return null
}

const problemaReferenciaDecisao = (d, i, registry) => {
  const alvo = registry.files[d.file]
  const doArquivo = problemaArquivoDecisao(d, i, alvo)
  if (doArquivo) return doArquivo
  return problemaCallsiteDecisao(d, i, alvo.entries.find((e) => e.line === d.line && e.column === d.column))
}

const problemaDecisao = (d, i, registry) => {
  if (!ehObjeto(d)) return `decisão de provenance #${i} não é objeto (${JSON.stringify(d)})`
  return problemaCamposDecisao(d, i)
    || problemaFormaDecisao(d, i)
    || problemaReferenciaDecisao(d, i, registry)
}

function validarDecisoesProvenance(o, registry) {
  const lista = o.provenanceDecisions
  if (lista === undefined) return null           // campo opcional
  if (!Array.isArray(lista)) return "provenanceDecisions ausente ou não é lista"

  const ancoras = new Set()
  for (const [i, d] of lista.entries()) {
    const problema = problemaDecisao(d, i, registry)
    if (problema) return problema

    const ancora = `${d.file}|${d.line}|${d.column}`
    if (ancoras.has(ancora)) return `decisão de provenance #${i}: âncora duplicada (${ancora})`
    ancoras.add(ancora)
  }
  return null
}

/**
 * Um override precisa apontar para algo que EXISTE.
 *
 * A versão anterior exigia `expectedFileHash` mas aceitava qualquer valor — a
 * proteção contra decisão humana migrar em silêncio não existia de fato. Aqui o
 * hash precisa bater com o do arquivo convertido, e o callsite `line+column`
 * precisa existir nas entradas. Caso contrário o override descreveria uma
 * decisão sobre código que ninguém olhou.
 */
const problemaCabecalhoOverrides = (o) => {
  if (!ehObjeto(o)) return "overrides não é um objeto"
  if (o.schema !== OVERRIDES_SCHEMA) return `schema de overrides desconhecido: ${JSON.stringify(o.schema)}`
  if (!Array.isArray(o.overrides)) return "overrides.overrides ausente ou não é lista"
  return null
}

const problemaCamposOverride = (ov, i) => {
  for (const campo of CAMPOS_OVERRIDE) {
    if (ov[campo] === undefined) return `override #${i} sem \`${campo}\``
  }
  for (const campo of ["reason", "owner", "evidence"]) {
    if (!naoVazio(ov[campo])) return `override #${i}: \`${campo}\` vazio`
  }
  return null
}

const problemaFormaOverride = (ov, i) => {
  const daPath = pathProblem(ov.file)
  if (daPath) return `override #${i}: ${daPath}`
  if (!inteiroPositivo(ov.line)) return `override #${i}: \`line\` inválida`
  if (!inteiroPositivo(ov.column)) return `override #${i}: \`column\` inválida`
  // `unknown` é estado de investigação, nunca destino de decisão humana: gastaria
  // toda a cerimônia do override sem resolver classificação alguma.
  if (ov.audience === "unknown") {
    return `override #${i}: \`unknown\` não é destino de decisão humana — é o estado que o override existe para resolver`
  }
  if (!OVERRIDABLE_AUDIENCES.includes(ov.audience)) return `override #${i}: audiência inválida: ${ov.audience}`
  return null
}

/** O override aponta para algo que EXISTE, com o conteúdo que ele julgou? */
const problemaReferencia = (ov, i, registry) => {
  const alvo = registry.files[ov.file]
  if (!alvo) return `override #${i}: \`${ov.file}\` não está em convertedFiles`
  if (!HASH_RE.test(ov.expectedFileHash)) return `override #${i}: \`expectedFileHash\` malformado`
  if (ov.expectedFileHash !== alvo.fileHash) {
    return `override #${i}: \`expectedFileHash\` não confere com o registry — o arquivo mudou desde a decisão`
  }
  if (!alvo.entries.some((e) => e.line === ov.line && e.column === ov.column)) {
    return `override #${i}: nenhum callsite em ${ov.file}:${ov.line}:${ov.column}`
  }
  return null
}

const problemaOverride = (ov, i, registry) => {
  if (!ehObjeto(ov)) return `override #${i} não é objeto (${JSON.stringify(ov)})`
  return problemaCamposOverride(ov, i)
    || problemaFormaOverride(ov, i)
    || problemaReferencia(ov, i, registry)
}

function validarOverrides(o, registry) {
  const cabecalho = problemaCabecalhoOverrides(o)
  if (cabecalho) return cabecalho

  const ancoras = new Set()
  for (const [i, ov] of o.overrides.entries()) {
    const problema = problemaOverride(ov, i, registry)
    if (problema) return problema

    const ancora = `${ov.file}|${ov.line}|${ov.column}`
    if (ancoras.has(ancora)) return `override #${i}: âncora duplicada (${ancora})`
    ancoras.add(ancora)
  }
  return null
}

// ── Frescor ──────────────────────────────────────────────────────────────────

function validarFrescor(r, repoRoot) {
  const divergentes = []
  for (const [file, dados] of Object.entries(r.files)) {
    const alvo = resolverDentro(repoRoot, file)
    if (!alvo.ok) { divergentes.push({ file, reason: alvo.reason }); continue }

    const leitura = lerFonte(alvo.abs)
    if (!leitura.ok) { divergentes.push({ file, reason: `ilegível: ${leitura.code}` }); continue }

    const atual = hashFileContent(leitura.texto)
    if (atual !== dados.fileHash) {
      divergentes.push({ file, reason: "conteúdo mudou desde a geração", expected: dados.fileHash, actual: atual })
    }
  }
  return divergentes
}

/**
 * Carrega registry + overrides e devolve veredito estruturado.
 *
 * `ok:true` acompanha `byFile`, um Map de arquivo convertido → entradas. Arquivo
 * fora de `convertedFiles` simplesmente não aparece: o inventário mantém o
 * extrator legado para ele POR DECLARAÇÃO, não por omissão.
 */
/** Lê e valida o arquivo GERADO. */
function carregarRegistry(repoRoot) {
  const reg = lerJson(join(repoRoot, REGISTRY_FILE), REGISTRY_FILE)
  if (!reg.ok) return reg
  const problema = validarForma(reg.data) || validarEntradas(reg.data)
  return problema ? falha("corrupt", problema, { file: REGISTRY_FILE }) : reg
}

/** Lê e valida o arquivo HUMANO, contra o registry já validado. */
function carregarOverrides(repoRoot, registry) {
  const ovr = lerJson(join(repoRoot, OVERRIDES_FILE), OVERRIDES_FILE)
  if (!ovr.ok) return ovr
  const problema = validarOverrides(ovr.data, registry) || validarDecisoesProvenance(ovr.data, registry)
  return problema ? falha("corrupt", problema, { file: OVERRIDES_FILE }) : ovr
}

/** Devolve `{ ok, reg, ovr }` ou o veredito de falha. */
function carregarPar(repoRoot) {
  const reg = carregarRegistry(repoRoot)
  if (!reg.ok) return reg
  const ovr = carregarOverrides(repoRoot, reg.data)
  if (!ovr.ok) return ovr
  return { ok: true, reg: reg.data, ovr: ovr.data }
}

export function loadJsRegistry({ repoRoot = process.cwd() } = {}) {
  const par = carregarPar(repoRoot)
  if (!par.ok) return par

  const divergentes = validarFrescor(par.reg, repoRoot)
  if (divergentes.length > 0) {
    return falha("stale",
      `${divergentes.length} arquivo(s) convertido(s) divergem do registry — regenerar com \`node scripts/i18n-registry.mjs\``,
      { files: divergentes })
  }

  // Tudo abaixo já foi validado: forma, referências, hash e frescor. O inventário
  // APLICA; não revalida. A marca de procedência é aposta AQUI, depois da
  // validação — nunca por quem consome.
  const veredito = {
    ok: true,
    status: "fresh",
    convertedFiles: [...par.reg.convertedFiles],
    byFile: new Map(Object.entries(par.reg.files).map(([f, d]) => [f, d.entries])),
    overrides: [...par.ovr.overrides],
    provenanceDecisions: [...(par.ovr.provenanceDecisions ?? [])],
  }
  VEREDITOS_VALIDADOS.add(veredito)
  return veredito
}
