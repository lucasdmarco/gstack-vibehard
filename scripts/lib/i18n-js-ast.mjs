/**
 * AST engine da Fase 1B — classificacao de pontos de saida JS. BUILD-TIME.
 *
 * Vive em `scripts/lib/` e NAO em `src/`: usa o compilador TypeScript, que e
 * devDependency. Importa-lo no runtime do CLI criaria dependencia de producao so
 * para classificar mensagens. O consumo em runtime sera de um JSON gerado
 * (Fatia 2/3), dado inerte.
 *
 * POR QUE AST, e nao regex. O extrator regex do inventario tem falso positivo
 * ESTRUTURAL: conta `export function info(msg)` — a DECLARACAO — como se fosse
 * chamada. Seis "unknown" de `cli/index.js` nao existem. E a fatia Python provou
 * que proximidade textual engana: uma escrita de fluxo normal foi classificada
 * como decisao de seguranca por um `if` cinco linhas acima que nao a envolvia.
 *
 * RESOLUCAO LEXICAL REAL. O prototipo agregava declaracoes do arquivo inteiro
 * num Set e ignorava parametros — um parametro `info` aninhado sombreava o
 * import e mesmo assim era atribuido ao import. Aqui a resolucao usa o
 * TypeChecker: `getSymbolAtLocation` no identificador do callee e
 * `getDeclarations()` no simbolo resolvido. O checker ja implementa escopo
 * lexico, shadowing e aliases corretamente; reimplementar isso a mao seria
 * reescrever um resolvedor com garantia de divergir.
 */
import ts from "typescript"
import { readFileSync } from "fs"

export const JS_AST_SCHEMA = "gstack.i18n-js-ast.v1"

/** Nomes que podem ser ponto de saida. O binding decide o que cada um E. */
const SINK_NAMES = new Set(["info", "warn", "error", "success", "section", "log"])

/** Primitivas exportadas que implementam o canal de saida humano. */
const RENDER_PRIMITIVES = new Set(["info", "warn", "error", "success", "section"])

/** Funcoes que perguntam e leem resposta do usuario. */
const PROMPT_FUNCTIONS = new Set(["select", "multiSelect", "prompt", "confirm"])

const norm = (p) => String(p).replace(/\\/g, "/")

/** O modulo canonico de render do CLI. */
export const RENDER_MODULE = "src/cli/index.js"

/**
 * A declaracao resolvida pertence ao modulo canonico de render?
 *
 * Checar so o NOME deixaria passar um `info` importado de outro pacote como se
 * fosse o canal publico oficial. Homonimo com origem diferente nao e o mesmo
 * binding — por isso a verificacao e sobre o ARQUIVO da declaracao, obtido do
 * checker, e nao sobre o texto do specifier.
 */
export function isCanonicalRenderFile(fileName) {
  return norm(fileName).endsWith(RENDER_MODULE)
}

// ── Programa TypeScript ──────────────────────────────────────────────────────

/**
 * Cria Program + TypeChecker. `allowJs` porque o alvo e JS puro; `checkJs`
 * fica desligado (nao queremos erros de tipo, so o resolvedor de simbolos).
 */
export function createAnalyzer(fileNames) {
  const program = ts.createProgram(fileNames, {
    allowJs: true, checkJs: false, noEmit: true,
    target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  })
  return { program, checker: program.getTypeChecker() }
}

/**
 * Resolve o binding REAL do identificador via checker.
 *
 * Devolve `kind`:
 *   `global`      — sem simbolo resolvivel no programa (ex.: `console`)
 *   `import`      — declaracao vem de outro arquivo
 *   `local`       — declaracao no mesmo arquivo (funcao, const)
 *   `parameter`   — SOMBREAMENTO: parametro com o mesmo nome
 *   `unresolved`  — checker nao resolveu; NUNCA presumir
 */
/** Segue alias (`import { info as log }`, re-export) ate a declaracao real. */
const unalias = (checker, sym) => {
  if (!(sym.flags & ts.SymbolFlags.Alias)) return sym
  try { return checker.getAliasedSymbol(sym) } catch { return sym }
}

const isImportDecl = (d) => ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d)

/** `console` e `process` nao tem declaracao no programa: sao globais do runtime. */
const GLOBAL_BINDING = Object.freeze({ kind: "global", declaredIn: null })

const bindingKindOf = (d, declaredIn, currentFile) => {
  if (ts.isParameter(d)) return "parameter"
  if (isImportDecl(d)) return "import"
  return declaredIn === norm(currentFile) ? "local" : "import"
}

export function resolveBinding(checker, node, currentFile) {
  const raw = checker.getSymbolAtLocation(node)
  if (!raw) return { kind: "global", declaredIn: null }
  const decls = unalias(checker, raw).getDeclarations()
  if (!decls?.length) return { kind: "unresolved", declaredIn: null }
  const d = decls[0]
  const declaredIn = norm(d.getSourceFile().fileName)
  return { kind: bindingKindOf(d, declaredIn, currentFile), declaredIn }
}

// ── Ancestralidade ───────────────────────────────────────────────────────────

const temNomeProprio = (n) => (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && Boolean(n.name)
const nomeDeVariavel = (p) => (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? p.name.text : null)

const funcName = (n) => {
  if (temNomeProprio(n)) return n.name.text
  return nomeDeVariavel(n.parent) ?? "<anon>"
}

const isFunctionLike = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)
  || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)

/** `export function f()` ou `export const f = () => …`. */
const temModificadorExport = (n) => {
  const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined
  return Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
}

const exportadoViaVariavel = (fn) => {
  const vd = fn.parent
  const stmt = vd && ts.isVariableDeclaration(vd) ? vd.parent?.parent : null
  return Boolean(stmt && ts.canHaveModifiers(stmt) && temModificadorExport(stmt))
}

const ehExportada = (fn) => temModificadorExport(fn) || exportadoViaVariavel(fn)

/**
 * Cadeia INTEIRA de funcoes envolventes, `inCatch`, e se alguma delas e
 * exportada. Usa a arvore, nunca proximidade textual.
 *
 * A cadeia inteira importa: a lista de opcoes de um prompt vive num arrow
 * aninhado (`<anon>` dentro de `select`), e olhar so a funcao imediata a perde.
 */
export function ancestry(node) {
  const functions = []
  let inCatch = false
  let exportedFromModule = false
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCatchClause(p)) inCatch = true
    if (!isFunctionLike(p)) continue
    functions.push(funcName(p))
    if (ehExportada(p)) exportedFromModule = true
  }
  return { functions, inCatch, exportedFromModule }
}

// ── Alcancabilidade intra-modulo (Task 3.1a) ─────────────────────────────────

/**
 * Quais funcoes do arquivo sao alcancaveis a partir de um export?
 *
 * POR QUE EXISTE. `monitor.js` tem 27 pontos de saida e UM unico export: as
 * chamadas vivem em funcoes internas, e `exportedFromModule` e `false` em todas.
 * Sem alcancabilidade, 24 pontos ficam `unknown` nao por ambiguidade real, mas
 * porque a regra so olhava a funcao imediata.
 *
 * FAIL-CLOSED, e a direcao importa. Uma aresta so nasce de chamada ESTATICA cujo
 * callee e identificador simples que o checker resolve para uma declaracao DESTE
 * arquivo. Tudo o mais — `obj[nome]()`, funcao passada como callback, import de
 * outro modulo, simbolo nao resolvido — nao cria aresta. O efeito e sempre o
 * mesmo: menos alcancavel, nunca mais. Ambiguidade reduz o que se afirma.
 */
const ehFuncaoNomeada = (st) => ts.isFunctionDeclaration(st) && Boolean(st.name)
const ehConstDeFuncao = (d) => ts.isIdentifier(d.name) && d.initializer && isFunctionLike(d.initializer)

const declaracoesDeVariavel = (st) =>
  (ts.isVariableStatement(st) ? st.declarationList.declarations.filter(ehConstDeFuncao) : [])

function declaracoesDeFuncao(sf) {
  const mapa = new Map()
  for (const st of sf.statements) {
    if (ehFuncaoNomeada(st)) mapa.set(st.name.text, st)
    for (const d of declaracoesDeVariavel(st)) mapa.set(d.name.text, d.initializer)
  }
  return mapa
}

/** A declaracao resolvida e uma das funcoes top-level DESTE arquivo? */
/**
 * IDENTIDADE do no, nao coincidencia de nome.
 *
 * Comparar so `decls.has(nome)` criava aresta em
 * `export function run(render) { render() }`: o parametro `render` sombreia a
 * funcao local homonima, esta declarado no mesmo arquivo e o nome batia — o
 * grafo passava a afirmar que a funcao local roda, quando quem decide o que
 * `render` e e o chamador de `run`.
 */
const ehMesmaDeclaracao = (d, declarada) =>
  d === declarada || (ts.isVariableDeclaration(d) && d.initializer === declarada)

const declaracaoResolvida = (checker, id, sf) => {
  const sym = checker.getSymbolAtLocation(id)
  if (!sym) return null
  const d = unalias(checker, sym).getDeclarations()?.[0]
  return d && d.getSourceFile() === sf ? d : null
}

const nomeLocalResolvido = (checker, id, sf, decls) => {
  const d = declaracaoResolvida(checker, id, sf)
  const declarada = decls.get(id.text)
  if (!d || !declarada) return null
  return ehMesmaDeclaracao(d, declarada) ? id.text : null
}

/** Arestas `chamadora -> chamada`, apenas de chamadas estaticas resolvidas. */
function arestasDeChamada(checker, sf, decls) {
  const arestas = new Map([...decls.keys()].map((k) => [k, new Set()]))
  for (const [nome, corpo] of decls) {
    const visitar = (n) => {
      // `f()` — identificador simples. `obj.f()` e `obj[k]()` NAO criam aresta:
      // resolver o receptor e o problema da 3.1b, e presumi-lo aqui inventaria
      // alcance que nao foi provado.
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const alvo = nomeLocalResolvido(checker, n.expression, sf, decls)
        if (alvo) arestas.get(nome).add(alvo)
      }
      ts.forEachChild(n, visitar)
    }
    visitar(corpo)
  }
  return arestas
}

/**
 * Conjunto de funcoes alcancaveis a partir dos exports. BFS com marcacao de
 * visitados — um ciclo `a -> b -> a` termina, e ambas seguem alcancaveis se a
 * raiz alcanca qualquer uma delas.
 */
export function alcancaveisDeExport(checker, sf) {
  const decls = declaracoesDeFuncao(sf)
  const arestas = arestasDeChamada(checker, sf, decls)
  const raizes = [...decls].filter(([, node]) => ehExportada(node)).map(([nome]) => nome)

  const alcancadas = new Set()
  const fila = [...raizes]
  while (fila.length > 0) {
    const atual = fila.shift()
    if (alcancadas.has(atual)) continue
    alcancadas.add(atual)
    for (const proximo of arestas.get(atual) ?? []) fila.push(proximo)
  }
  return { alcancadas, raizes: new Set(raizes), declaradas: new Set(decls.keys()) }
}

/**
 * O ponto esta dentro de funcao alcancavel a partir de um export?
 *
 * A cadeia de `ancestry` vem de dentro para fora, entao a ultima entrada e a
 * funcao top-level. `<anon>` — callback, IIFE, arrow solto — nao tem nome que
 * case com o grafo e por isso NAO e alcancavel: quem passou o callback e quem
 * decide se ele roda, e isso nao esta provado aqui.
 */
export function alcancavelDaqui(cadeiaDeFuncoes, alcance) {
  if (cadeiaDeFuncoes.length === 0) return false
  // `<anon>` em QUALQUER posicao da cadeia derruba, nao so no topo. Um arrow
  // inline dentro de um export — `lista.forEach(() => …)` — depende de quem
  // recebeu o callback para rodar. Na pratica ele quase sempre roda; "quase
  // sempre" nao e o criterio, e olhar so o topo da cadeia o aprovaria.
  if (cadeiaDeFuncoes.includes("<anon>")) return false
  return alcance.alcancadas.has(cadeiaDeFuncoes[cadeiaDeFuncoes.length - 1])
}

/** Env vars que constituem ativacao explicita de depuracao. */
const DEBUG_ENV_VARS = new Set(["GSTACK_DEBUG", "DEBUG", "VERBOSE"])

/** O no e exatamente `process.env`? Nem `cfg.env`, nem `process.argv`. */
const ehProcessEnv = (n) => ts.isPropertyAccessExpression(n)
  && ts.isIdentifier(n.name) && n.name.text === "env"
  && ts.isIdentifier(n.expression) && n.expression.text === "process"

/** O identificador da propriedade e uma das env vars aprovadas? */
const ehVarDebug = (n) => ts.isIdentifier(n) && DEBUG_ENV_VARS.has(n.text)

/** Leitura crua de `process.env.<VAR_APROVADA>` — sem julgar polaridade. */
const lePodeDebugEnv = (n) => ts.isPropertyAccessExpression(n)
  && ehVarDebug(n.name) && ehProcessEnv(n.expression)

const semParenteses = (e) => (ts.isParenthesizedExpression(e) ? semParenteses(e.expression) : e)

/**
 * A condicao exige debug LIGADO para o ramo THEN executar?
 *
 * Nao basta a condicao MENCIONAR `process.env.DEBUG`: e preciso que o valor
 * positivo seja NECESSARIO. A versao da Fatia 1.1 so perguntava "aparece?", e
 * por isso repetia — com outra roupa — a mesma inversao ja corrigida no `else`:
 *
 *   `!process.env.GSTACK_DEBUG`      → o THEN roda com debug DESLIGADO;
 *   `process.env.DEBUG || outra`     → o THEN roda sempre que `outra` for true,
 *                                      mesmo com debug desligado.
 *
 * Em ambos, marcar `internal_debug` afirmaria que a saida esta fora do fluxo
 * padrao quando ela esta exatamente dentro dele.
 *
 * Regra: `&&` propaga (basta um operando exigir), `||` nunca (nenhum operando e
 * necessario), negacao inverte, comparacao e ambigua. Na duvida NAO e debug — o
 * erro conservador deixa o ponto como saida normal, que e o pior caso seguro.
 */
export function requiresDebugEnv(expr) {
  const e = semParenteses(expr)
  if (ts.isPrefixUnaryExpression(e)) return false      // `!DEBUG` inverte
  if (!ts.isBinaryExpression(e)) return lePodeDebugEnv(e)
  if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return requiresDebugEnv(e.left) || requiresDebugEnv(e.right)
  }
  return false                                          // `||` e comparacoes
}

/**
 * Nomes que, como condicao, denotam MODO MAQUINA.
 *
 * Curto e literal: `json`, `--json`, `asJson`. Nao ha inferencia semantica — um
 * `if (config)` nao vira modo maquina por ser uma flag qualquer.
 */
const MACHINE_FLAG = /^(?:--)?(?:json|as_?json|machine)$/i

/**
 * Despacho por FORMA do no, em tabela.
 *
 * A versao em cascata de `if`s tinha complexidade ciclomatica 11 e crescia a
 * cada forma nova. A tabela mantem cada caso legivel isoladamente e o
 * caminhamento em um lugar so.
 */
const FLAG_POR_FORMA = [
  [ts.isIdentifier, (e) => MACHINE_FLAG.test(e.text)],
  [ts.isStringLiteral, (e) => MACHINE_FLAG.test(e.text)],
  [ts.isPropertyAccessExpression, (e) => ts.isIdentifier(e.name) && MACHINE_FLAG.test(e.name.text)],
  [ts.isPrefixUnaryExpression, (e, rec) => rec(e.operand)],
  [ts.isParenthesizedExpression, (e, rec) => rec(e.expression)],
  [ts.isBinaryExpression, (e, rec) => rec(e.left) || rec(e.right)],
  [ts.isCallExpression, (e, rec) => e.arguments.some(rec)],
]

/** A condicao menciona explicitamente a flag de saida de maquina? */
function mencionaFlagDeMaquina(expr) {
  if (!expr) return false
  const caso = FLAG_POR_FORMA.find(([ehForma]) => ehForma(expr))
  return caso ? Boolean(caso[1](expr, mencionaFlagDeMaquina)) : false
}

/** `filho` esta contido em `alvo` por POSICAO na arvore? */
const contains = (alvo, filho) => Boolean(alvo)
  && filho.getStart() >= alvo.getStart() && filho.getEnd() <= alvo.getEnd()

/**
 * O ponto esta sob guarda de ativacao explicita de debug?
 *
 * Quatro exigencias:
 *   1. condicao ESTRUTURALMENTE `process.env.<VAR>` (nao regex de texto);
 *   2. debug positivo NECESSARIO — `!DEBUG` e `DEBUG || outra` recusados;
 *   3. o no precisa estar no ramo THEN — uma chamada no `else` roda quando o
 *      debug esta DESLIGADO, e classifica-la como debug seria o oposto;
 *   4. ancestralidade real — guard em funcao vizinha nao alcanca.
 */
export function underDebugGuard(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (isFunctionLike(p)) break
    if (!ts.isIfStatement(p)) continue
    if (!requiresDebugEnv(p.expression)) continue
    if (contains(p.thenStatement, node)) return true
    // No ramo `else` (ou fora do then): NAO e caminho de debug.
  }
  return false
}

/**
 * O ponto esta no ramo de MODO MAQUINA (`if (json) …`)?
 *
 * Mesma disciplina de `underDebugGuard`: para na fronteira da funcao, porque uma
 * condicao fora dela nao controla este ponto, e olha SO o ramo `then` — no `else`
 * de `if (json)` estamos justamente no caminho humano.
 */
export function underMachineGuard(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (isFunctionLike(p)) break
    if (!ts.isIfStatement(p)) continue
    if (!mencionaFlagDeMaquina(p.expression)) continue
    if (contains(p.thenStatement, node)) return true
  }
  return false
}

/** Identificadores interpolados num template literal (sem resolver origem). */
function templateIdentifiers(arg) {
  if (!arg || !ts.isTemplateExpression(arg)) return null
  const ids = []
  for (const span of arg.templateSpans) {
    const visit = (n) => {
      if (ts.isIdentifier(n)) ids.push(n.text)
      ts.forEachChild(n, visit)
    }
    visit(span.expression)
  }
  return ids
}

// ── Regras ───────────────────────────────────────────────────────────────────

// ── Evidencia ESTRUTURAL do argumento ────────────────────────────────────────

/**
 * Serializadores que constituem prova de payload de maquina.
 *
 * A lista e curta de proposito e olha a CHAMADA, nao o nome da variavel: um
 * `const json = "texto humano"` nao vira protocolo por se chamar json.
 */
const SERIALIZADORES = new Set(["JSON.stringify"])

/** Nome pontuado do callee, quando ele e `obj.metodo` ou `f`. Senao `null`. */
function calleeDotted(node) {
  if (!ts.isCallExpression(node)) return null
  const c = node.expression
  if (ts.isIdentifier(c)) return c.text
  if (!ts.isPropertyAccessExpression(c) || !ts.isIdentifier(c.name)) return null
  return ts.isIdentifier(c.expression) ? `${c.expression.text}.${c.name.text}` : null
}

/**
 * A string e composta SO de bytes de controle do terminal?
 *
 * Sequencias CSI (`\x1b[...`), BEL, CR e backspace nao tem idioma: nao ha o que
 * traduzir num apagar-linha. Uma unica letra fora de sequencia derruba a
 * classificacao — `\x1b[2KAborted` e texto que o usuario le, com enfeite.
 */
const SO_CONTROLE = /^(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_]|[\r\b\n\t ])+$/

/** Partes literais que servem apenas de separador entre payloads. */
const SO_SEPARADOR = (s) => /^[\r\n\t ]*$/.test(s)

/**
 * Decompoe a expressao de saida em PARTES, atravessando concatenacao e template.
 *
 * `process.stdout.write(JSON.stringify(x) + "\n")` e a forma dominante no
 * repositorio: sem atravessar o `+`, o serializador ficaria escondido atras de
 * uma BinaryExpression e o ponto seria opaco.
 */
const ehConcatenacao = (n) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken
const ehLiteralDeTexto = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)

const espalharTemplate = (node, acc, rec) => {
  acc.push({ tipo: "literal", texto: node.head.text })
  for (const s of node.templateSpans) {
    rec(s.expression, acc)
    acc.push({ tipo: "literal", texto: s.literal.text })
  }
}

/** Uma forma por linha; o caminhamento fica em `partesDaExpressao`. */
const PARTE_POR_FORMA = [
  [ts.isParenthesizedExpression, (n, acc, rec) => rec(n.expression, acc)],
  [ehConcatenacao, (n, acc, rec) => { rec(n.left, acc); rec(n.right, acc) }],
  [ts.isTemplateExpression, espalharTemplate],
  [ehLiteralDeTexto, (n, acc) => acc.push({ tipo: "literal", texto: n.text })],
]

const empurrarChamada = (node, acc) => {
  const dotted = calleeDotted(node)
  if (dotted && SERIALIZADORES.has(dotted)) acc.push({ tipo: "serializador", nome: dotted })
  else acc.push({ tipo: "opaco" })
}

function partesDaExpressao(node, acc = []) {
  if (!node) return acc
  const caso = PARTE_POR_FORMA.find(([ehForma]) => ehForma(node))
  if (caso) caso[1](node, acc, partesDaExpressao)
  else empurrarChamada(node, acc)
  return acc
}

/**
 * Forma do argumento — evidencia ESTRUTURAL, nunca leitura de conteudo.
 *
 *   `serializer`    toda parte e serializador ou separador em branco;
 *   `control_only`  literais compostos so de bytes de controle;
 *   `text`          ha literal com texto legivel;
 *   `opaque`        identificador ou chamada arbitraria — nao se sabe.
 *
 * `opaque` NAO e um resultado ruim: e a recusa em adivinhar. Um `write(buffer)`
 * pode ser qualquer coisa, e classificar por otimismo foi o erro que a fatia
 * Python ja cometeu uma vez.
 */
/** Resumo das partes — computado uma vez, lido pelas regras de forma. */
const resumoDasPartes = (partes) => {
  const literais = partes.filter((p) => p.tipo === "literal")
  return {
    literais,
    serializador: partes.find((p) => p.tipo === "serializador")?.nome ?? null,
    temOpaco: partes.some((p) => p.tipo === "opaco"),
    soSeparadores: literais.every((l) => SO_SEPARADOR(l.texto)),
    soControle: literais.length > 0 && literais.every((l) => SO_CONTROLE.test(l.texto)),
    temTexto: literais.some((l) => l.texto.trim().length > 0),
  }
}

/**
 * Uma linha por forma, da evidencia mais forte para a mais fraca.
 *
 * `text_literal` e `text` sao formas SEPARADAS porque provam coisas diferentes.
 * Uma frase inteiramente literal e mensagem redigida para alguem ler. Assim que
 * entra parte opaca (`"SELECT * FROM " + tabela`), a expressao pode formar
 * qualquer coisa — inclusive uma query logada num modulo de banco, que foi
 * exatamente o caso em que a primeira versao de `command-human-branch`
 * classificou como canal humano do CLI algo que nao e canal do CLI.
 */
const FORMAS_DO_ARGUMENTO = [
  [(r) => r.serializador && !r.temOpaco && r.soSeparadores, (r) => ({ forma: "serializer", serializador: r.serializador })],
  [(r) => !r.serializador && !r.temOpaco && r.soControle, () => ({ forma: "control_only" })],
  [(r) => r.temTexto && !r.temOpaco, () => ({ forma: "text_literal" })],
  [(r) => r.temTexto, () => ({ forma: "text" })],
]

export function formaDoArgumento(arg) {
  const partes = partesDaExpressao(arg)
  if (partes.length === 0) return { forma: "none", partes }
  const r = resumoDasPartes(partes)
  const caso = FORMAS_DO_ARGUMENTO.find(([quando]) => quando(r))
  return { ...(caso ? caso[1](r) : { forma: "opaque" }), partes }
}

/**
 * CONSUMIDORES DECLARADOS de protocolo de maquina.
 *
 * `machine_protocol` exige serializador estrutural E consumidor provado — as
 * duas coisas, sempre. Sem esta lista, todo `write(JSON.stringify(x))` viraria
 * protocolo por parecer um, e a categoria vira o deposito de "casos sem idioma"
 * contra o qual `i18n-audiences.js` avisa explicitamente.
 *
 * Cada entrada nomeia o teste que CONSOME a saida. Nasce vazia de proposito: a
 * Task 3 instala a regra, e cada arquivo migrado a preenche com a prova dele
 * (ver `tests/i18n_js_ast_command_surfaces.test.js`, que exercita a regra com
 * consumidor injetado, e a Fatia 4, que migra `monitor.js` e `create.js`).
 */
export const MACHINE_PROTOCOL_CONSUMERS = Object.freeze({})

/**
 * As tres condicoes de `command-human-branch`, nomeadas separadamente.
 *
 *   canal    — e `console` do runtime, fora do modulo canonico de render;
 *   alcance  — a funcao e exportada OU alcancavel a partir de um export (3.1a);
 *   frase    — argumento INTEIRAMENTE literal e fora do ramo `if (json)`.
 *
 * Separa-las nao e so higiene: cada uma responde a uma pergunta diferente, e
 * confundi-las foi o que produziu o falso positivo do `select` SQL.
 */
const ehConsoleDeProjeto = (p) => !isCanonicalRenderFile(p.file)
  && p.binding.kind === "global"
  && String(p.callee).startsWith("console.")

const ehSuperficieDeComando = (p) => p.exportedFromModule || p.reachableFromExport === true

const ehFraseHumana = (p) => p.argForm === "text_literal" && p.underMachineGuard !== true

/**
 * Ordem: da evidencia mais especifica para a menos. `unknown` e o ultimo
 * recurso — estado de INVESTIGACAO, jamais "interno" por default.
 *
 * `runtime-stack-passthrough` do prototipo foi REMOVIDA: classificava qualquer
 * propriedade de erro em catch como `external_passthrough`. Errado, e reincidencia
 * do erro ja corrigido na fatia Python — se o GStack DECIDE imprimir `err.stack`,
 * a exposicao e dele. `external_passthrough` exige subprocesso externo
 * identificado e bytes encaminhados sem transformacao.
 */
export const JS_RULES = Object.freeze([
  {
    id: "debug-guarded",
    when: (p) => p.underDebugGuard,
    audience: "internal_debug",
    trigger: "debug_flag",
    reason: "sob guarda de ativacao explicita de debug: fora do fluxo padrao",
    risk: "raw_stack_paths_and_secrets",
  },
  {
    id: "render-primitive-impl",
    when: (p) => isCanonicalRenderFile(p.file)
      && p.binding.kind === "global"
      && RENDER_PRIMITIVES.has(p.functions[0])
      && p.exportedFromModule,
    audience: "render_primitive",
    trigger: "channel_implementation",
    reason: "console.* dentro da primitiva exportada que implementa o canal: o texto vem do chamador, a funcao so decora. Classificar como publico duplicaria a contagem",
  },
  {
    // RESTRITA ao modulo canonico. A 1a versao classificava QUALQUER funcao
    // chamada `select`/`prompt`/`confirm` em QUALQUER modulo como interface
    // publica — um `select` de query SQL noutro arquivo viraria prompt.
    id: "interactive-prompt",
    when: (p) => isCanonicalRenderFile(p.file)
      && p.binding.kind === "global"
      && p.functions.some((f) => PROMPT_FUNCTIONS.has(f)),
    audience: "public_interactive",
    trigger: "user_prompt",
    reason: "saida em qualquer nivel dentro de funcao de prompt DO MODULO CANONICO: o usuario le e responde",
  },
  {
    // Usa `canonicalName` (nome DECLARADO), nao o apelido local: `info as say`
    // continua sendo a primitiva `info`.
    id: "render-via-canonical-helper",
    when: (p) => (p.binding.kind === "import" || p.binding.kind === "local")
      && RENDER_PRIMITIVES.has(p.canonicalName)
      && isCanonicalRenderFile(p.binding.declaredIn || ""),
    audience: "public_diagnostic",
    trigger: "sanctioned_channel",
    reason: "helper de render cuja DECLARACAO resolve no modulo canonico — nome canonico e origem conferidos pelo checker",
  },
  {
    id: "render-module-literal-output",
    when: (p) => isCanonicalRenderFile(p.file) && p.binding.kind === "global",
    audience: "public_diagnostic",
    trigger: "render_module_surface",
    reason: "console.* no modulo de render que nao e primitiva/prompt/debug: por identidade do modulo, e texto que o usuario le",
  },
  {
    /**
     * Ramo HUMANO de comando exportado — a regra mais arriscada desta leva, e
     * por isso a mais restrita das cinco.
     *
     * Ela NAO aprova `console.*` em massa. Exige, de uma vez: chamada a
     * `console` (global do runtime, nao um homonimo de projeto), dentro de
     * funcao EXPORTADA, com argumento de forma `text` — literal legivel, nunca
     * `opaque` nem serializador — e FORA de qualquer ramo `if (json)`. Um
     * comando que imprime JSON no ramo maquina e texto no ramo humano tem os
     * dois pontos classificados de forma diferente, que e o comportamento certo:
     * a audiencia e do PONTO, nao do arquivo.
     */
    id: "command-human-branch",
    when: (p) => ehConsoleDeProjeto(p) && ehSuperficieDeComando(p) && ehFraseHumana(p),
    audience: "public_diagnostic",
    trigger: "command_human_branch",
    reason: "console.* com argumento INTEIRAMENTE literal, em funcao exportada, fora do ramo de maquina: frase redigida para alguem ler. Parte opaca derruba a regra: concatenar identificador desconhecido forma qualquer coisa, inclusive uma query logada num modulo de banco, que nao e canal do CLI",
  },
])

/**
 * Regras de ESCRITA DIRETA em stream — separadas das demais de proposito.
 *
 * Um `process.stdout.write` nao pode ser classificado pela identidade do arquivo:
 * `render-module-literal-output` daria `public_diagnostic` a todo write do modulo
 * de render, e um payload JSON viraria "texto que o usuario le". Aqui a decisao
 * vem SO da forma da expressao (`formaDoArgumento`) e da guarda que envolve o
 * ponto. O que nao casar nenhuma destas tres continua `unknown`: extrair sem
 * evidencia mantem o ponto visivel, classificar sem evidencia o falsifica.
 */
export const SINK_RULES = Object.freeze([
  {
    // Guarda POSITIVA. `requiresDebugEnv` ja garante que `!DEBUG` e
    // `DEBUG || outra` nao contam: no ramo THEN dessas duas o debug esta
    // DESLIGADO, e chamar aquilo de `internal_debug` afirmaria que a saida esta
    // fora do fluxo padrao justamente quando ela esta dentro dele.
    id: "stream-debug-guarded",
    when: (p) => p.underDebugGuard === true,
    audience: "internal_debug",
    trigger: "debug_flag",
    reason: "escrita em stream sob ativacao explicita de debug",
    risk: "raw_stack_paths_and_secrets",
  },
  {
    id: "stream-json-protocol",
    when: (p, ctx) => p.argForm === "serializer" && Boolean(ctx.consumers[p.file]),
    audience: "machine_protocol",
    trigger: "structural_serializer",
    reason: "payload de serializador estrutural com consumidor DECLARADO — as duas coisas; serializador sozinho nao prova que alguem consome",
  },
  {
    id: "stream-terminal-control",
    when: (p) => p.argForm === "control_only",
    audience: "terminal_control",
    trigger: "control_bytes",
    reason: "literal composto so de bytes de controle (CSI/BEL/CR): nao ha idioma num apagar-linha",
  },
])

const aplicar = (regras, p, ctx) => {
  const r = regras.find((x) => x.when(p, ctx))
  if (!r) return { audience: "unknown", trigger: null, rule: null }
  return { audience: r.audience, trigger: r.trigger, rule: r.id }
}

export function classifyPoint(p, ctx = {}) {
  const consumers = ctx.consumers ?? MACHINE_PROTOCOL_CONSUMERS
  if (p.sink) return aplicar(SINK_RULES, p, { consumers })
  return aplicar(JS_RULES, p, { consumers })
}

export const rules = () => JS_RULES.map(({ id, audience, trigger, reason, risk }) =>
  ({ id, audience, trigger, reason, ...(risk ? { risk } : {}) }))

// ── Extracao ─────────────────────────────────────────────────────────────────

/**
 * Extrai e classifica pontos de saida de um arquivo, com binding resolvido pelo
 * checker. `parameter` NAO e ponto de saida do canal — e sombreamento, e a
 * ausencia de regra o mantem `unknown` de proposito.
 */
/**
 * Nome, objeto e o identificador a resolver, para `f()` e `obj.f()`.
 * Devolve `null` quando a expressao do callee nao e nenhuma das duas formas.
 */
function calleeInfo(c) {
  if (ts.isIdentifier(c)) return { name: c.text, objeto: null, idNode: c }
  if (!ts.isPropertyAccessExpression(c) || !ts.isIdentifier(c.name)) return null
  const ehIdent = ts.isIdentifier(c.expression)
  return {
    name: c.name.text,
    objeto: ehIdent ? c.expression.text : null,
    // Para `ns.info()` o simbolo a resolver e o MEMBRO (`info`), nao o objeto
    // namespace. A 1a versao resolvia `c.expression` e por isso um
    // `import * as cli` devolvia o namespace, nunca a primitiva.
    idNode: c.name,
    objectNode: ehIdent ? c.expression : null,
  }
}

/** Streams de escrita direta do processo. */
const PROCESS_STREAMS = new Set(["stdout", "stderr"])

/** `process.stdout` / `process.stderr` — devolve o nome do stream, ou `null`. */
const streamDeProcess = (n) => {
  if (!ts.isPropertyAccessExpression(n)) return null
  if (!ts.isIdentifier(n.expression) || n.expression.text !== "process") return null
  if (!ts.isIdentifier(n.name) || !PROCESS_STREAMS.has(n.name.text)) return null
  return n.name.text
}

/**
 * A chamada e `process.stdout.write(...)` ou `process.stderr.write(...)`?
 *
 * Ha mais de cem ocorrencias distribuidas por dezenas de arquivos — inclusive `monitor.js` e
 * `create.js`. `write` nao esta em SINK_NAMES e o callee tem cadeia ANINHADA
 * (`process.stdout` nao e identificador simples), entao `calleeInfo` devolvia
 * `objeto: null` e o ponto era descartado. Consequencia se isso entrasse no
 * registry: cada arquivo migrado do regex para o AST PERDERIA seus sinks de
 * stream — o inventario ficaria menor sem que nada tivesse sido resolvido.
 *
 * Extrair e obrigatorio; classificar, nao. Ver `classifyPoint`.
 */
export function processStreamWrite(c) {
  if (!ts.isPropertyAccessExpression(c)) return null
  if (!ts.isIdentifier(c.name) || c.name.text !== "write") return null
  const stream = streamDeProcess(c.expression)
  if (!stream) return null
  return { stream, calleePath: `process.${stream}.write` }
}

/**
 * Nome CANONICO do alvo: o nome com que a funcao foi DECLARADA, nao o nome
 * local do callsite.
 *
 * Existe porque a 1a versao filtrava por `SINK_NAMES` usando o nome local — e
 * `import { info as say }` nunca chegava a ser extraido, ja que `say` nao esta
 * na lista. Alias arbitrario precisa funcionar: o que define um ponto de saida
 * e a funcao que ele CHAMA, nao como o arquivo decidiu apelida-la.
 */
const nomeSeIdentifier = (n) => (n && ts.isIdentifier(n) ? n.text : null)

/**
 * Nome ESCRITO na primeira declaracao do simbolo.
 *
 * Em `import { info as say }`, `propertyName` e `info` (o nome de origem) e
 * `name` e `say` (o apelido local) — e o de origem que decide.
 */
function nomeDaDeclaracao(sym) {
  const d = sym.getDeclarations()?.[0]
  if (!d) return null
  if (ts.isImportSpecifier(d)) return (d.propertyName ?? d.name).text
  return nomeSeIdentifier(d.name)
}

export function canonicalNameOf(checker, idNode) {
  const raw = checker.getSymbolAtLocation(idNode)
  if (!raw) return null
  const sym = unalias(checker, raw)
  return nomeDaDeclaracao(sym) ?? sym.getName() ?? null
}

export function analyzeFile(filePath, analyzer = null, ctx = {}) {
  const a = analyzer || createAnalyzer([filePath])
  const sf = a.program.getSourceFile(filePath)
  if (!sf) throw new Error(`arquivo nao esta no programa: ${filePath}`)
  const pontos = []
  // Calculado UMA vez por arquivo: o grafo e do modulo, nao do ponto.
  const alcance = alcancaveisDeExport(a.checker, sf)

  const registrar = (node, d) => {
    const arg0 = node.arguments[0]
    const caminho = d.alvo.objeto ? `${d.alvo.objeto}.${d.alvo.name}` : d.alvo.name
    // `line` sozinha NAO identifica um callsite: duas chamadas cabem na mesma
    // linha, inclusive do mesmo helper (`info("a"); info("b")`). Um override
    // ancorado so em linha atingiria a chamada errada, em silencio.
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    const base = {
      file: norm(filePath),
      line: pos.line + 1,
      column: pos.character + 1,
      name: d.alvo.name,
      // Nome DECLARADO — e ele que decide o que a chamada e, nao o apelido local.
      canonicalName: d.canonicalName,
      callee: caminho,
      calleePath: d.calleePath ?? caminho,
      // `stdout` | `stderr` para escrita direta no processo; `null` no resto.
      sink: d.sink ?? null,
      binding: d.binding,
      ...ancestry(node),
      underDebugGuard: underDebugGuard(node),
      underMachineGuard: underMachineGuard(node),
      // Funcao top-level que contem o ponto (ultima da cadeia de ancestralidade).
      reachableFromExport: alcancavelDaqui(ancestry(node).functions, alcance),
      templateIds: templateIdentifiers(arg0),
      argKind: arg0 ? ts.SyntaxKind[arg0.kind] : "none",
      // Forma ESTRUTURAL do argumento — o que permite decidir sobre um
      // `process.*.write` sem apelar para a identidade do arquivo.
      argForm: formaDoArgumento(arg0).forma,
    }
    pontos.push({ ...base, ...classifyPoint(base, ctx) })
  }

  /** `console` e global do runtime: nao ha simbolo de projeto a resolver. */
  const resolverAlvo = (alvo) => {
    if (alvo.objeto === "console") return { binding: GLOBAL_BINDING, canonicalName: alvo.name }
    return {
      binding: resolveBinding(a.checker, alvo.idNode, filePath),
      canonicalName: canonicalNameOf(a.checker, alvo.idNode) ?? alvo.name,
    }
  }

  /** Escrita direta no stream: sempre extraida, nunca classificada por default. */
  const descreverStream = (w) => ({
    alvo: { name: "write", objeto: `process.${w.stream}` },
    canonicalName: "write",
    binding: GLOBAL_BINDING,
    sink: w.stream,
    calleePath: w.calleePath,
  })

  /**
   * RESOLVE PRIMEIRO, filtra depois. A 1a versao filtrava por `SINK_NAMES` no
   * nome LOCAL e perdia todo alias arbitrario antes mesmo de resolver.
   */
  const descreverChamada = (node) => {
    const w = processStreamWrite(node.expression)
    if (w) return descreverStream(w)
    const alvo = calleeInfo(node.expression)
    if (!alvo) return null
    const r = resolverAlvo(alvo)
    return SINK_NAMES.has(r.canonicalName) ? { alvo, ...r } : null
  }

  const visit = (node) => {
    const ponto = ts.isCallExpression(node) ? descreverChamada(node) : null
    if (ponto) registrar(node, ponto)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return pontos
}

/**
 * Provenance do argumento. Separada da classificacao porque template literal com
 * interpolacao NAO prova origem do dado: `${plan.id}` e do projeto, `${objective}`
 * e do usuario, `${count}` e derivado. Sem analise de fluxo ate um parametro de
 * entrada, fica `unresolved`.
 */
export function argumentProvenance(p) {
  if (!p.templateIds || p.templateIds.length === 0) return { resolved: true, kind: "literal_only", ids: [] }
  return { resolved: false, kind: "interpolated", ids: p.templateIds }
}
