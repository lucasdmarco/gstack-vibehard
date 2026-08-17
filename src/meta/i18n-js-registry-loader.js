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
// `no_local_frame`: ha interpolacao mas nenhuma moldura literal com texto — so
// espacamento entre dados. Nao e `literal_only` (ha ids) nem `interpolated`
// (nao ha frase a traduzir), e por isso e um kind proprio.
const PROVENANCE_KINDS = Object.freeze(["literal_only", "interpolated", "no_local_frame"])

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
export const PROVENANCE_STRATEGIES = Object.freeze([
  "translate_literal_frame_preserve_interpolations",
  // Ponto SEM moldura literal — o template é só espaçamento entre dados. Não há
  // frame a traduzir, e por isso a estratégia anterior não se aplica: ela promete
  // preservar interpolações DENTRO de uma frase que aqui não existe. Exige provar,
  // valor a valor, que nenhum deles carrega linguagem.
  "preserve_nonlinguistic_dynamic_values",
  /**
   * Ponto SEM moldura literal cujo valor interpolado E LINGUISTICO — prosa
   * redigida noutro lugar do projeto e apenas RENDERIZADA aqui.
   *
   * Nasceu de tres callsites reais que nenhuma das duas anteriores descrevia sem
   * mentir: `translate_literal_frame_preserve_interpolations` promete traduzir
   * uma moldura que aqui nao existe, e `preserve_nonlinguistic_dynamic_values`
   * exigiria declarar a frase como `glyph`/`identifier`/`control` — falso no
   * unico campo que o revisor consegue conferir.
   *
   * A contrapartida do vocabulario novo e ser MAIS exigente, nao menos: em vez
   * de categoria por valor, exige a ORIGEM ancorada (arquivo, linha, coluna e
   * hash do arquivo de origem). Uma origem que se mova invalida a decisao, do
   * mesmo jeito que `expectedFileHash` do sink ja faz.
   */
  "translate_at_value_origin",
  /**
   * Ponto SEM moldura literal cujo valor interpolado E LINGUISTICO e NAO E
   * NOSSO — conteudo do usuario ou de fonte documental externa, transportado e
   * exibido pelo GStack sem traducao.
   *
   * Nasceu de `context.js:201`, que nenhuma das outras tres descrevia sem
   * mentir: nao ha frame a traduzir; declarar um trecho de documento como
   * `glyph`/`identifier`/`control` seria falso; e `translate_at_value_origin`
   * exigiria ancorar a origem num literal de modulo do PROJETO, que nao existe
   * — o texto nasce em runtime, do arquivo do usuario.
   *
   * A DIFERENCA PARA `translate_at_value_origin` E O DESTINO, nao a forma: la a
   * frase e nossa e deve ser traduzida NA ORIGEM; aqui ela nunca deve ser
   * traduzida, em lugar nenhum. Por isso `translationSite` e PROIBIDO nesta
   * estrategia — declara-lo seria dizer o contrario do que ela significa.
   *
   * A contrapartida e ser mais exigente onde importa: cada valor precisa dizer
   * de que ESPECIE de fonte veio e por qual FRONTEIRA entrou no processo, e a
   * cadeia nao pode ter literal linguistico do projeto (fallback, prefixo ou
   * sufixo) misturado ao conteudo.
   */
  "preserve_user_content_verbatim",
])

/**
 * De quem e o conteudo. Lista FECHADA — cresce com evidencia, nunca por
 * conveniencia, como todas as outras deste modulo.
 *
 * NENHUMA delas descreve texto produzido pelo proprio pacote: e justamente essa
 * a fronteira que a estrategia existe para marcar. Saida do nosso subprocesso,
 * por exemplo, so entra aqui quando o subprocesso ECOA conteudo do usuario — e
 * a prova disso e da camada estrutural, nao do JSON.
 */
export const USER_CONTENT_SOURCE_KINDS = Object.freeze([
  "indexed_user_document",    // trecho de documento que o usuario indexou
  "user_supplied_input",      // argumento, resposta ou arquivo que o usuario forneceu
  "external_service_payload", // corpo devolvido por servico de terceiros
])

/**
 * Por onde o conteudo ENTROU no processo. Sem isto a decisao afirmaria "e do
 * usuario" sem dizer como se sabe — e a fronteira e exatamente o lugar onde o
 * projeto poderia ter misturado texto proprio sem ninguem notar.
 */
export const USER_CONTENT_BOUNDARIES = Object.freeze([
  "subprocess_stdout",   // capturado de um processo filho
  "file_read",           // lido de arquivo em disco
  "cli_argument",        // veio da linha de comando
  "network_response",    // veio da rede
])

/**
 * Onde a frase e REDIGIDA. Lista FECHADA, e curta pelo mesmo motivo das outras:
 * cresce com evidencia, nunca por conveniencia. Hoje os dois casos provados sao
 * literais escritos em modulo do proprio projeto.
 */
export const ORIGIN_SOURCE_KINDS = Object.freeze(["project_module_literal"])

/** A decisao precisa DIZER que a traducao acontece na origem, nao no sink. */
export const TRANSLATION_SITE_ORIGIN = "value_origin"

/**
 * Estratégia e `kind` da provenance precisam CASAR.
 *
 * Sem esta regra, `preserve_nonlinguistic_dynamic_values` viraria a saída fácil
 * para qualquer moldura inconveniente: bastaria declará-la não-linguística e a
 * frase literal deixaria de ser traduzida sem que ninguém a tivesse lido.
 */
/**
 * `no_local_frame` passou a aceitar DUAS, e a escolha nao e livre: elas se
 * excluem pelo que a decisao consegue PROVAR. `preserve_nonlinguistic_dynamic_values`
 * exige categoria fechada por valor; `translate_at_value_origin` exige origem
 * ancorada e proibe categoria. Nenhuma decisao satisfaz as duas.
 *
 * `interpolated` continua com UMA: havendo moldura literal, a traducao e daqui,
 * e mandar traduzir "na origem" deixaria a moldura orfa.
 */
export const STRATEGY_BY_KIND = Object.freeze({
  interpolated: Object.freeze(["translate_literal_frame_preserve_interpolations"]),
  no_local_frame: Object.freeze([
    "preserve_nonlinguistic_dynamic_values",
    "translate_at_value_origin",
    "preserve_user_content_verbatim",
  ]),
})

/** Unica audiencia em que `preserve_user_content_verbatim` faz sentido. */
export const USER_CONTENT_AUDIENCE = "user_content"

/**
 * Categorias de valor dinâmico que podem ser preservados sem tradução.
 *
 * Lista FECHADA e curta. `human_text` e `unknown` não estão aqui de propósito: se
 * o valor pode carregar linguagem, a decisão de não traduzi-lo precisa ser feita
 * em outro lugar, com outro argumento — não escondida numa categoria genérica.
 */
export const NONLINGUISTIC_VALUE_CATEGORIES = Object.freeze(["glyph", "identifier", "control"])

/**
 * `preserve_nonlinguistic_dynamic_values` exige metadado por VALOR, não prosa.
 *
 * Uma justificativa em texto livre é irrefutável por construção: quem revisa não
 * tem como checar se ela cobre todos os identificadores ou só os convenientes.
 * Aqui cada id declarado em `interpolations` precisa de uma entrada em
 * `values` com categoria da lista fechada e origem ancorada — e a cobertura é
 * comparada id a id, então esquecer um reprova.
 */
const problemaDeUmValor = (v, id) => {
  if (!ehObjeto(v)) return `\`values.${id}\` ausente`
  if (!NONLINGUISTIC_VALUE_CATEGORIES.includes(v.category)) {
    return `\`values.${id}.category\` inválida: ${JSON.stringify(v.category)}`
  }
  return naoVazio(v.origin) ? null : `\`values.${id}.origin\` vazio`
}

const problemaValoresNaoLinguisticos = (d, i) => {
  if (d.strategy !== "preserve_nonlinguistic_dynamic_values") return null
  if (!ehObjeto(d.values)) return `decisão de provenance #${i}: \`values\` ausente ou não é objeto`

  for (const id of d.interpolations) {
    const problema = problemaDeUmValor(d.values[id], id)
    if (problema) return `decisão de provenance #${i}: ${problema}`
  }

  const extras = Object.keys(d.values).filter((k) => !d.interpolations.includes(k))
  return extras.length === 0 ? null
    : `decisão de provenance #${i}: \`values\` descreve id inexistente: ${extras.join(", ")}`
}

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

/**
 * `translate_at_value_origin` — a ORIGEM e o que a decisao tem de provar.
 *
 * O que esta camada verifica, com o disco na mao: a origem existe, esta contida
 * no repositorio, e o `expectedFileHash` dela CONFERE. Uma frase que se mova
 * invalida a decisao, exatamente como o hash do sink ja faz — e e isso que
 * impede a decisao de envelhecer em silencio quando o modulo de origem muda.
 *
 * O que esta camada NAO verifica, e esta dito para nao parecer que verifica: se
 * a linha/coluna apontam para um literal REALMENTE traduzivel, e se ha uma so
 * origem possivel. Isso exige AST, e este modulo e runtime sem TypeScript por
 * contrato. A prova estrutural vive em
 * `tests/i18n_translate_at_value_origin.test.js`, que resolve cada origem pelo
 * engine e reprova nome de variavel/propriedade/metodo como evidencia.
 *
 * CATEGORIA E PROIBIDA aqui. `glyph`/`identifier`/`control` pertencem a
 * `preserve_nonlinguistic_dynamic_values`; aceita-las nas duas faria a escolha
 * entre estrategias virar preferencia, e a diferenca entre "nao tem idioma" e
 * "tem idioma, e mora noutro lugar" e justamente o que se quer registrar.
 */
const CAMPOS_DA_ORIGEM = ["file", "line", "column", "expectedFileHash"]

const campoAusente = (o, campos) => campos.find((c) => o[c] === undefined)

const problemaAncoraDaOrigem = (o, id) => {
  if (!inteiroPositivo(o.line)) return `\`values.${id}.origin.line\` inválida`
  // Coluna EXIGIDA: duas frases cabem na mesma linha, e ancorar só por linha
  // atingiria a errada em silêncio.
  if (!inteiroPositivo(o.column)) return `\`values.${id}.origin.column\` inválida`
  return HASH_RE.test(o.expectedFileHash) ? null : `\`values.${id}.origin.expectedFileHash\` malformado`
}

const problemaFormaDaOrigem = (o, id) => {
  if (!ehObjeto(o)) return `\`values.${id}.origin\` ausente ou não é objeto`
  const faltando = campoAusente(o, CAMPOS_DA_ORIGEM)
  if (faltando) return `\`values.${id}.origin.${faltando}\` ausente`
  const daPath = pathProblem(o.file)
  return daPath ? `\`values.${id}.origin.file\`: ${daPath}` : problemaAncoraDaOrigem(o, id)
}

/** A origem existe em disco, está contida no repo e o hash dela confere? */
const problemaOrigemNoDisco = (o, id, repoRoot) => {
  const alvo = resolverDentro(repoRoot, o.file)
  if (!alvo.ok) return `\`values.${id}.origin.file\`: ${alvo.reason}`
  const fonte = lerFonte(alvo.abs)
  if (!fonte.ok) return `\`values.${id}.origin.file\` ilegível: ${fonte.code}`
  if (hashFileContent(fonte.texto) !== o.expectedFileHash) {
    return `\`values.${id}.origin\` obsoleta — o arquivo de origem mudou desde a decisão`
  }
  return null
}

const CAMPOS_DE_JUSTIFICATIVA = ["reason", "owner", "evidence"]
const justificativaVazia = (v) => CAMPOS_DE_JUSTIFICATIVA.find((c) => !naoVazio(v[c]))

const problemaDoValorDeOrigem = (v, id) => {
  if (v.id !== id) return `\`values.${id}.id\` não confere com a chave`
  if (v.category !== undefined) {
    return `\`values.${id}.category\` não pertence a esta estratégia — categoria é de \`preserve_nonlinguistic_dynamic_values\``
  }
  if (!ORIGIN_SOURCE_KINDS.includes(v.sourceKind)) {
    return `\`values.${id}.sourceKind\` inválido: ${JSON.stringify(v.sourceKind)}`
  }
  const vazio = justificativaVazia(v)
  return vazio ? `\`values.${id}.${vazio}\` vazio` : null
}

const problemaDeUmaOrigem = (v, id, repoRoot) => {
  if (!ehObjeto(v)) return `\`values.${id}\` ausente`
  return problemaDoValorDeOrigem(v, id)
    || problemaFormaDaOrigem(v.origin, id)
    || problemaOrigemNoDisco(v.origin, id, repoRoot)
}

/**
 * EXATAMENTE um por templateId, nos dois sentidos: faltar deixa um valor sem
 * decisão, sobrar declara origem para um id que o gerador não extraiu.
 */
const problemaDeCobertura = (d) => {
  const extras = Object.keys(d.values).filter((id) => !d.interpolations.includes(id))
  return extras.length > 0 ? `\`values\` tem entrada sem templateId correspondente: ${extras.join(", ")}` : null
}

const problemaDeAlgumaOrigem = (d, repoRoot) => {
  for (const id of d.interpolations) {
    const problema = problemaDeUmaOrigem(d.values[id], id, repoRoot)
    if (problema) return problema
  }
  return null
}

/**
 * `preserve_user_content_verbatim` — o conteudo e do USUARIO, e a decisao tem de
 * dizer de que especie de fonte veio e por qual fronteira entrou.
 *
 * `origin` e OPCIONAL aqui, e isso nao e frouxidao: o texto nasce em runtime e
 * frequentemente NAO tem ancora no repositorio. Quando houver — um literal do
 * projeto no caminho —, ela e validada com o mesmo rigor das outras estrategias,
 * hash incluso. O que nao se aceita e ancora meia-boca.
 */
const problemaDoValorDoUsuario = (v, id) => {
  if (v.id !== id) return `\`values.${id}.id\` não confere com a chave`
  if (v.category !== undefined) {
    return `\`values.${id}.category\` não pertence a esta estratégia — categoria é de \`preserve_nonlinguistic_dynamic_values\``
  }
  if (!USER_CONTENT_SOURCE_KINDS.includes(v.sourceKind)) {
    return `\`values.${id}.sourceKind\` inválido: ${JSON.stringify(v.sourceKind)}`
  }
  if (!USER_CONTENT_BOUNDARIES.includes(v.boundary)) {
    return `\`values.${id}.boundary\` inválida: ${JSON.stringify(v.boundary)}`
  }
  const vazio = justificativaVazia(v)
  return vazio ? `\`values.${id}.${vazio}\` vazio` : null
}

const problemaDeUmValorDoUsuario = (v, id, repoRoot) => {
  if (!ehObjeto(v)) return `\`values.${id}\` ausente`
  const doValor = problemaDoValorDoUsuario(v, id)
  if (doValor || v.origin === undefined) return doValor
  return problemaFormaDaOrigem(v.origin, id) || problemaOrigemNoDisco(v.origin, id, repoRoot)
}

const problemaDeAlgumValorDoUsuario = (d, repoRoot) => {
  for (const id of d.interpolations) {
    const problema = problemaDeUmValorDoUsuario(d.values[id], id, repoRoot)
    if (problema) return problema
  }
  return null
}

const problemaConteudoDoUsuario = (d, i, repoRoot) => {
  if (d.strategy !== "preserve_user_content_verbatim") return null
  if (d.translationSite !== undefined) {
    return `decisão de provenance #${i}: \`translationSite\` NÃO pertence a esta estratégia — ela significa preservar conteúdo do usuário, jamais traduzi-lo em lugar nenhum`
  }
  if (!ehObjeto(d.values)) return `decisão de provenance #${i}: \`values\` ausente ou não é objeto`
  const problema = problemaDeCobertura(d) || problemaDeAlgumValorDoUsuario(d, repoRoot)
  return problema ? `decisão de provenance #${i}: ${problema}` : null
}

const problemaOrigensLinguisticas = (d, i, repoRoot) => {
  if (d.strategy !== "translate_at_value_origin") return null
  if (d.translationSite !== TRANSLATION_SITE_ORIGIN) {
    return `decisão de provenance #${i}: \`translationSite\` deve ser ${JSON.stringify(TRANSLATION_SITE_ORIGIN)} — a decisão precisa DIZER que a tradução é na origem, não no sink`
  }
  if (!ehObjeto(d.values)) return `decisão de provenance #${i}: \`values\` ausente ou não é objeto`
  const problema = problemaDeCobertura(d) || problemaDeAlgumaOrigem(d, repoRoot)
  return problema ? `decisão de provenance #${i}: ${problema}` : null
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
  return problemaValoresNaoLinguisticos(d, i)
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

const problemaIdsDaDecisao = (d, i, entrada) => {
  const gerado = entrada.provenance.ids ?? []
  if (mesmosIds(d.interpolations, gerado)) return null
  return `decisão de provenance #${i}: interpolações divergem do gerado (decidido=${JSON.stringify([...d.interpolations].sort())}, gerado=${JSON.stringify([...gerado].sort())})`
}

const problemaEntradaDaDecisao = (d, i, entrada) => {
  if (!entrada) return `decisão de provenance #${i}: nenhum callsite em ${d.file}:${d.line}:${d.column}`
  if (entrada.provenance?.resolved !== false) {
    return `decisão de provenance #${i}: o callsite ${d.file}:${d.line}:${d.column} já tem provenance resolvida — decisão desnecessária`
  }
  return null
}

/** O curto-circuito garante `entrada` válida nas etapas seguintes. */
const problemaCallsiteDecisao = (d, i, entrada, audiencia) => problemaEntradaDaDecisao(d, i, entrada)
  || problemaIdsDaDecisao(d, i, entrada)
  || problemaEstrategiaVsKind(d, i, entrada.provenance.kind)
  || problemaAudienciaDaEstrategia(d, i, audiencia || entrada.audience)

/**
 * `preserve_user_content_verbatim` so vale onde a audiencia JA diz que o
 * conteudo nao e nosso.
 *
 * Sem esta porta a estrategia viraria atalho: bastaria declarar "e do usuario"
 * num ponto classificado como diagnostico publico e a frase sairia da claim sem
 * que ninguem tivesse revisto a audiencia. A audiencia e a decisao de CANAL e
 * vem antes; a estrategia so descreve o que fazer com o valor.
 *
 * A audiencia EFETIVA e a do override quando existe, e a do registry quando nao
 * — porque override e exatamente o mecanismo de decisao humana de canal, e ele e
 * aplicado no inventario, depois de o registry ja estar gravado. Ler so o
 * registry aqui recusaria toda decisao legitima.
 */
const problemaAudienciaDaEstrategia = (d, i, audiencia) => {
  if (d.strategy !== "preserve_user_content_verbatim") return null
  if (audiencia === USER_CONTENT_AUDIENCE) return null
  return `decisão de provenance #${i}: \`preserve_user_content_verbatim\` exige audiência \`${USER_CONTENT_AUDIENCE}\`, e o callsite ${d.file}:${d.line}:${d.column} está como \`${audiencia}\``
}

const ancoraDe = (file, line, column) => `${file}|${line}|${column}`

/** Audiencia declarada por override para a ancora, ou `null`. */
const audienciaDeOverride = (overrides, chave) => {
  const ov = (overrides ?? []).find((o) => ancoraDe(o.file, o.line, o.column) === chave)
  return ov ? ov.audience : null
}

/**
 * A estratégia precisa casar com o kind do ponto REAL. Sem isto,
 * `preserve_nonlinguistic_dynamic_values` seria a saída fácil para qualquer
 * moldura inconveniente: bastaria declará-la não-linguística e a frase literal
 * deixaria de ser traduzida sem que ninguém a tivesse lido.
 */
const problemaEstrategiaVsKind = (d, i, kind) => {
  const aceitas = STRATEGY_BY_KIND[kind]
  if (!aceitas || aceitas.includes(d.strategy)) return null
  return `decisão de provenance #${i}: estratégia \`${d.strategy}\` incompatível com \`provenance.kind: ${kind}\` (aceitas: ${aceitas.join(", ")})`
}

const problemaReferenciaDecisao = (d, i, registry, audiencia) => {
  const alvo = registry.files[d.file]
  const doArquivo = problemaArquivoDecisao(d, i, alvo)
  if (doArquivo) return doArquivo
  const entrada = alvo.entries.find((e) => e.line === d.line && e.column === d.column)
  return problemaCallsiteDecisao(d, i, entrada, audiencia)
}

const problemaDecisao = (d, i, registry, repoRoot, audiencia) => {
  if (!ehObjeto(d)) return `decisão de provenance #${i} não é objeto (${JSON.stringify(d)})`
  return problemaCamposDecisao(d, i)
    || problemaFormaDecisao(d, i)
    || problemaOrigensLinguisticas(d, i, repoRoot)
    || problemaConteudoDoUsuario(d, i, repoRoot)
    || problemaReferenciaDecisao(d, i, registry, audiencia)
}

function validarDecisoesProvenance(o, registry, repoRoot) {
  const lista = o.provenanceDecisions
  if (lista === undefined) return null           // campo opcional
  if (!Array.isArray(lista)) return "provenanceDecisions ausente ou não é lista"

  const ancoras = new Set()
  for (const [i, d] of lista.entries()) {
    const ancora = ancoraDe(d.file, d.line, d.column)
    const problema = problemaDecisao(d, i, registry, repoRoot, audienciaDeOverride(o.overrides, ancora))
    if (problema) return problema

    if (ancoras.has(ancora)) return `decisão de provenance #${i}: âncora duplicada (${ancora})`
    ancoras.add(ancora)
  }
  return problemaConteudoDoUsuarioSemDecisao(registry, ancoras, o.overrides)
}

/**
 * FECHA O ATALHO que a audiência `user_content` abriria sozinha.
 *
 * `unresolvedProvenance` só cobra decisão de ponto `in_scope`, e `user_content`
 * está fora da claim. Sem esta checagem, marcar um ponto como conteúdo do
 * usuário o tiraria do gate SEM decisão nenhuma — e a estratégia nova viraria
 * decoração opcional, exatamente o que ela existe para impedir.
 *
 * Aqui a exigência é explícita: ponto de conteúdo do usuário, sem moldura e com
 * provenance não resolvida PRECISA declarar `preserve_user_content_verbatim`.
 * A audiência diz de quem é o canal; a decisão diz de onde veio o texto e por
 * qual fronteira entrou. Uma não substitui a outra.
 */
const exigeDecisaoDeUsuario = (e, audiencia) => audiencia === USER_CONTENT_AUDIENCE
  && e.provenance?.resolved === false
  && e.provenance?.kind === "no_local_frame"

function problemaConteudoDoUsuarioSemDecisao(registry, ancoras, overrides) {
  for (const [file, dados] of Object.entries(registry.files)) {
    for (const e of dados.entries) {
      const chave = ancoraDe(file, e.line, e.column)
      const audiencia = audienciaDeOverride(overrides, chave) ?? e.audience
      if (!exigeDecisaoDeUsuario(e, audiencia) || ancoras.has(chave)) continue
      return `${file}:${e.line}:${e.column} é \`${USER_CONTENT_AUDIENCE}\` com provenance não resolvida e NÃO declara \`preserve_user_content_verbatim\` — audiência não substitui decisão`
    }
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

/**
 * REVISÃO HUMANA ANCORADA — quando NENHUMA regra estrutural pode decidir.
 *
 * Existe por um caso concreto: `runtime-supervisor.js:346`. O valor impresso é o
 * log do processo supervisionado, mas a cadeia é
 *
 *   followLog → readTail(logPath) → readSync(fd, buffer, …)
 *              → buffer.subarray(…).toString(…) → write(…)
 *
 * e o `readSync` preenche o buffer por EFEITO COLATERAL: o retorno não guarda
 * vínculo sintático com a leitura. O checker não resolve, e não deve fingir que
 * resolveu.
 *
 * O QUE ESTES CAMPOS IMPEDEM é a decisão se disfarçar de derivação. Ela precisa
 * DIZER que a resolução estrutural falhou (`structuralResolution`) e em que se
 * apoia (`decisionBasis`). Sem isso, um override anônimo seria indistinguível de
 * uma classificação automática ao revisar o JSON.
 *
 * `expectedIds` fecha a última fresta: a decisão declara os identificadores
 * interpolados que ela julgou, e diverge se o callsite ganhar um. Junto com
 * `expectedFileHash` — que cobre o arquivo inteiro, e portanto também `readTail`
 * e `followLog` —, qualquer mudança na cadeia invalida a decisão.
 *
 * NÃO cria regra genérica para Buffer, para `toString()`, para funções chamadas
 * `readTail` nem para parâmetros passados a `write`: vale para UMA âncora.
 */
export const DECISION_BASES = Object.freeze(["anchored_human_review"])

/**
 * Só `unresolved` é honesto aqui: se o checker tivesse resolvido, a decisão
 * humana não seria necessária, e declarar `resolved` seria reivindicar uma
 * derivação que não houve.
 */
export const STRUCTURAL_RESOLUTIONS = Object.freeze(["unresolved"])

const mesmaLista = (a, b) => {
  const x = [...a].sort()
  const y = [...b].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/** Os três campos são um bloco: ou nenhum, ou todos válidos. */
const semRevisaoAncorada = (ov) => ov.decisionBasis === undefined
  && ov.structuralResolution === undefined
  && ov.expectedIds === undefined

const problemaRevisaoAncorada = (ov, i) => {
  if (semRevisaoAncorada(ov)) return null
  if (!DECISION_BASES.includes(ov.decisionBasis)) {
    return `override #${i}: \`decisionBasis\` inválido: ${JSON.stringify(ov.decisionBasis)}`
  }
  if (!STRUCTURAL_RESOLUTIONS.includes(ov.structuralResolution)) {
    return `override #${i}: \`structuralResolution\` deve ser ${JSON.stringify(STRUCTURAL_RESOLUTIONS[0])} — decisão humana não reivindica derivação`
  }
  return Array.isArray(ov.expectedIds) ? null : `override #${i}: \`expectedIds\` ausente ou não é lista`
}

/** Os identificadores julgados batem com os que o gerador extraiu? */
const problemaIdsDoOverride = (ov, i, entrada) => {
  if (ov.expectedIds === undefined) return null
  const gerado = entrada.provenance?.ids ?? []
  if (mesmaLista(ov.expectedIds, gerado)) return null
  return `override #${i}: \`expectedIds\` diverge do gerado (decidido=${JSON.stringify([...ov.expectedIds].sort())}, gerado=${JSON.stringify([...gerado].sort())})`
}

/** O override aponta para algo que EXISTE, com o conteúdo que ele julgou? */
const problemaReferencia = (ov, i, registry) => {
  const alvo = registry.files[ov.file]
  if (!alvo) return `override #${i}: \`${ov.file}\` não está em convertedFiles`
  if (!HASH_RE.test(ov.expectedFileHash)) return `override #${i}: \`expectedFileHash\` malformado`
  if (ov.expectedFileHash !== alvo.fileHash) {
    return `override #${i}: \`expectedFileHash\` não confere com o registry — o arquivo mudou desde a decisão`
  }
  const entrada = alvo.entries.find((e) => e.line === ov.line && e.column === ov.column)
  if (!entrada) return `override #${i}: nenhum callsite em ${ov.file}:${ov.line}:${ov.column}`
  return problemaIdsDoOverride(ov, i, entrada)
}

const problemaOverride = (ov, i, registry) => {
  if (!ehObjeto(ov)) return `override #${i} não é objeto (${JSON.stringify(ov)})`
  return problemaCamposOverride(ov, i)
    || problemaFormaOverride(ov, i)
    || problemaRevisaoAncorada(ov, i)
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
  const problema = validarOverrides(ovr.data, registry)
    || validarDecisoesProvenance(ovr.data, registry, repoRoot)
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
