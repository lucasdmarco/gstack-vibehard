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

export function declaracoesDeFuncaoPublica(sf) { return declaracoesDeFuncao(sf) }

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
export function alcancaveisDeExport(checker, sf, raizesExtras = null) {
  const decls = declaracoesDeFuncao(sf)
  const arestas = arestasDeChamada(checker, sf, decls)
  //  RESTRINGE em vez de somar quando fornecido: sao os handlers
  // do DISPATCH que vivem neste arquivo, e o criterio estrito nao aceita export
  // qualquer como origem.
  const raizes = raizesExtras
    ? [...raizesExtras].filter((n) => decls.has(n))
    : [...decls].filter(([, node]) => ehExportada(node)).map(([nome]) => nome)

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

// ── Entrypoints canonicos (Task 3.1c parte 2) ────────────────────────────────

/**
 * Handlers de comando derivados do objeto `DISPATCH` REAL de `src/cli/index.js`.
 *
 * POR QUE SO O DISPATCH. `COMMANDS` e `command-layers.js` descrevem o catalogo e
 * a camada de cada comando; nenhum dos dois EXECUTA nada. Autoridade de execucao
 * e o mapa que o CLI consulta para chamar o handler, e so ele prova que uma
 * funcao e alcancada por invocacao real do usuario.
 *
 * POR QUE IMPORTA. "Alcancavel a partir de um export qualquer" e frouxo demais:
 * `export function select(t) { console.log("SELECT * FROM " + t) }` num modulo
 * de banco satisfaz isso e NAO e canal do CLI. Com moldura interpolada em jogo,
 * esse criterio reintroduziria o falso positivo do SQL — por isso `text` so
 * recebe audiencia com entrypoint canonico provado, nunca com export.
 *
 * FAIL-CLOSED. So conta `nome: (a) => handler(a)` ou `nome: handler`, com o
 * identificador resolvido pelo checker ate a declaracao. Chave computada,
 * spread, corpo com mais de uma expressao, handler que nao e chamada direta —
 * nada disso vira raiz. Forma nao comprovada permanece fora.
 */
/** Expressao do arrow, quando o corpo e uma unica expressao (ou um unico return). */
const corpoDeExpressaoUnica = (fn) => {
  if (!ts.isBlock(fn.body)) return fn.body
  const [st] = fn.body.statements
  return fn.body.statements.length === 1 && st && ts.isReturnStatement(st) ? st.expression : null
}

const chamadaDiretaDe = (expr) => {
  if (ts.isIdentifier(expr)) return expr
  if (!isFunctionLike(expr)) return null
  const corpo = corpoDeExpressaoUnica(expr)
  const ehDelegacao = corpo && ts.isCallExpression(corpo) && ts.isIdentifier(corpo.expression)
  return ehDelegacao ? corpo.expression : null
}

const ehDeclaracaoDeDispatch = (d) => ts.isIdentifier(d.name) && d.name.text === "DISPATCH"
  && d.initializer && ts.isObjectLiteralExpression(d.initializer)

const objetoDispatch = (sf) => {
  for (const st of sf.statements) {
    const achada = ts.isVariableStatement(st)
      ? st.declarationList.declarations.find(ehDeclaracaoDeDispatch) : null
    if (achada) return achada.initializer
  }
  return null
}

/**
 * Uma entrada do `DISPATCH` -> `{ arquivo, nome }` da declaracao do handler.
 * `null` sempre que a forma nao prova qual funcao roda: chave computada, spread,
 * corpo com mais de uma expressao, simbolo que o checker nao resolve.
 */
const ehEntradaNomeada = (prop) => ts.isPropertyAssignment(prop) && !ts.isComputedPropertyName(prop.name)

const declaracaoDoHandler = (id, checker) => {
  const bruto = id ? checker.getSymbolAtLocation(id) : null
  return bruto ? (unalias(checker, bruto).getDeclarations()?.[0] ?? null) : null
}

/**
 * Nome do COMANDO na chave do `DISPATCH` — `create:` ou `"publish-guard":`.
 *
 * Chave computada ja foi barrada por `ehEntradaNomeada`; aqui so restam as duas
 * formas literais. Qualquer outra devolve `null` e a entrada nao vira raiz: o
 * comando precisa ser LEGIVEL estaticamente para poder ser declarado numa prova.
 */
const nomeDaChave = (n) => {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  return ts.isIdentifier(n) ? n.text : null
}

function raizDaPropriedade(prop, checker) {
  if (!ehEntradaNomeada(prop)) return null
  const decl = declaracaoDoHandler(chamadaDiretaDe(prop.initializer), checker)
  const nome = decl ? (nomeSeIdentifier(decl.name) ?? nomeDeVariavel(decl.parent)) : null
  if (!nome) return null
  return { arquivo: norm(decl.getSourceFile().fileName), nome, comando: nomeDaChave(prop.name) }
}

/**
 * Entradas do `DISPATCH` por arquivo, PRESERVANDO o comando:
 * `{ "<arquivo>": [{ command, handler }] }`.
 *
 * `entrypointsCanonicos` colapsava isto num `Set` de nomes de handler, e com o
 * comando perdido nao havia como distinguir `dev`/`stop` de `logs`/`open` dentro
 * de `runtime-supervisor.js` — os quatro moram no mesmo arquivo. Um consumidor
 * provado para um NAO pode cobrir os outros, e essa distincao so existe se o
 * comando sobreviver a derivacao.
 *
 * A cadeia continua sendo a canonica: comando -> handler -> import -> arquivo,
 * com o identificador resolvido pelo checker ate a declaracao. Vazio quando o
 * `DISPATCH` nao e encontrado — ausencia de prova, nao permissao.
 */
const objetoDispatchDoPrograma = (program) => {
  const index = program.getSourceFiles().find((s) => isCanonicalRenderFile(s.fileName))
  return index ? objetoDispatch(index) : null
}

/**
 * Entrada utilizavel do DISPATCH, ou `null`. Sem comando legivel a entrada nao
 * entra: alias nao resolvido e chave dinamica nao podem virar cobertura.
 */
const entradaDeComando = (prop, checker) => {
  const raiz = raizDaPropriedade(prop, checker)
  if (!raiz) return null
  return raiz.comando ? { arquivo: raiz.arquivo, command: raiz.comando, handler: raiz.nome } : null
}

const acrescentar = (mapa, chave, valor) => {
  if (!mapa.has(chave)) mapa.set(chave, [])
  mapa.get(chave).push(valor)
}

export function entrypointsPorComando(program, checker) {
  const porArquivo = new Map()
  const obj = objetoDispatchDoPrograma(program)
  if (!obj) return porArquivo
  for (const prop of obj.properties) {
    const e = entradaDeComando(prop, checker)
    if (e) acrescentar(porArquivo, e.arquivo, { command: e.command, handler: e.handler })
  }
  return porArquivo
}

/**
 * Grafo de alcance de CADA comando, separadamente.
 *
 * A uniao dos handlers (`alcanceCanonico`) responde "algum comando chega aqui?".
 * Para a ancora fina a pergunta e outra — "QUAIS comandos chegam aqui?" —, e ela
 * so tem resposta com um grafo por raiz.
 */
function alcancePorComandoDe(checker, sf, entradas) {
  const mapa = new Map()
  for (const e of entradas ?? []) {
    if (!mapa.has(e.command)) mapa.set(e.command, alcancaveisDeExport(checker, sf, [e.handler]))
  }
  return mapa
}

/** Comandos que alcancam a cadeia de funcoes do ponto. Ordenado: saida estavel. */
const comandosQueAlcancam = (cadeia, alcancePorComando) => [...alcancePorComando]
  .filter(([, alcance]) => alcancavelDaqui(cadeia, alcance))
  .map(([comando]) => comando)
  .sort()

/**
 * Declaracoes-raiz por arquivo: `{ "<arquivo>": Set<nomeDaFuncao> }`.
 * Projecao de `entrypointsPorComando` — mesma derivacao, comando descartado.
 */
export function entrypointsCanonicos(program, checker) {
  const porArquivo = new Map()
  for (const [arquivo, entradas] of entrypointsPorComando(program, checker)) {
    porArquivo.set(arquivo, new Set(entradas.map((e) => e.handler)))
  }
  return porArquivo
}

// ── Provenance do receptor (Task 3.1b) ───────────────────────────────────────

/**
 * DOMINIO ABSTRATO do receptor de um metodo — `logger.warn(...)`.
 *
 * `create.js` tem 78 pontos nessa forma, e `logger` e SEMPRE parametro: quem
 * decide o que ele e sao os chamadores. O checker resolve o membro (`warn`), nao
 * o objeto, e por isso todos ficavam `unknown`.
 *
 * Tres estados, e a ordem do join importa:
 *
 *   unresolved  — falta prova. ABSORVE tudo: um unico callsite dinamico,
 *                 externo ou irresolvivel derruba a analise inteira, porque
 *                 basta um caminho nao inspecionado para a conclusao ser falsa;
 *   canonical   — todos os callsites convergem para a MESMA origem provada;
 *   conflict    — origens diferentes. Nao e "escolha a mais comum": duas origens
 *                 significam que o mesmo codigo imprime em canais diferentes.
 *
 * O que NUNCA basta: o nome `logger`, o metodo ser `warn`/`info`/`error`, ou o
 * argumento ser literal. Sao exatamente os sinais que parecem prova e nao sao.
 */
export const RECEPTOR_UNRESOLVED = Object.freeze({ state: "unresolved", origin: null })
export const receptorCanonical = (origin) => Object.freeze({ state: "canonical", origin })
export const RECEPTOR_CONFLICT = Object.freeze({ state: "conflict", origin: null })

/** `unresolved` absorve; origens iguais mantem; diferentes viram `conflict`. */
const temEstado = (a, b, e) => a.state === e || b.state === e

const estadoDominanteDoReceptor = (a, b) => {
  if (temEstado(a, b, "unresolved")) return RECEPTOR_UNRESOLVED
  if (temEstado(a, b, "conflict")) return RECEPTOR_CONFLICT
  return null
}

const receptorAusente = (a, b) => !a || !b

export function joinReceptor(a, b) {
  if (receptorAusente(a, b)) return a ?? b
  const dominante = estadoDominanteDoReceptor(a, b)
  if (dominante) return dominante
  return a.origin === b.origin ? a : RECEPTOR_CONFLICT
}

/**
 * Limite de iteracoes do fixpoint.
 *
 * Repasse de parametro (`f(logger)` chamando `g(logger)`) forma cadeias, e ciclo
 * mutuo forma laco. O limite e DETERMINISTICO e o estouro vira `unresolved`, nao
 * uma resposta parcial: uma analise que nao convergiu nao sabe o que concluiu.
 */
export const LIMITE_FIXPOINT = 12

/**
 * Origem canonica de um argumento, no ponto de chamada.
 *
 * So conta import cuja declaracao resolve no modulo canonico de render — o mesmo
 * criterio de `render-via-canonical-helper`, que ja exige CONTRATO de audiencia
 * comprovado. Namespace (`import * as cli`), objeto literal montado na hora,
 * chamada de fabrica e qualquer expressao que nao seja identificador resolvido
 * ficam `unresolved`.
 */
const ehBindingDeclarado = (k) => k === "import" || k === "local"

const receptorDeParametro = (arg) => ({ state: "parameter", origin: null, nome: arg.text })

const receptorDoBinding = (binding) => {
  if (!ehBindingDeclarado(binding.kind)) return RECEPTOR_UNRESOLVED
  const canonico = binding.declaredIn && isCanonicalRenderFile(binding.declaredIn)
  return canonico ? receptorCanonical(norm(binding.declaredIn)) : RECEPTOR_UNRESOLVED
}

export function origemDoArgumento(arg, checker, currentFile) {
  if (!arg || !ts.isIdentifier(arg)) return RECEPTOR_UNRESOLVED
  const b = resolveBinding(checker, arg, currentFile)
  return b.kind === "parameter" ? receptorDeParametro(arg) : receptorDoBinding(b)
}

// ── Propagacao field-sensitive (Task 3.1b.1) ─────────────────────────────────

/**
 * O objeto literal e um LOGGER CANONICO LOCAL?
 *
 * `create.js:63` define `defaultLogger` como literal cujos metodos escrevem em
 * `console.*`. Ele nao vem do modulo de render, mas E o canal humano do modulo —
 * e o contrato de audiencia esta a vista, no proprio corpo de cada metodo.
 *
 * Exige que TODAS as propriedades sejam funcoes que escrevem em `console`. Uma
 * unica que faca outra coisa derruba: um objeto meio-logger nao e logger.
 */
/** A chamada e `console.<metodo>(...)` com `console` GLOBAL, nao um homonimo. */
const chamadaDeMembro = (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
const identificadorConsole = (n) => ts.isIdentifier(n) && n.text === "console"
const declaradoNaLib = (d) => d.getSourceFile().isDeclarationFile

const ehEmissaoDeConsole = (n, checker) => {
  if (!chamadaDeMembro(n)) return false
  const obj = n.expression.expression
  if (!identificadorConsole(obj)) return false

  // `console` TEM simbolo — o TypeScript o resolve pela lib padrao —, entao
  // "sem simbolo = global" estava errado. O que distingue o global do runtime de
  // um `const console = {…}` local e ONDE ele foi declarado: lib (`.d.ts`) ou
  // codigo do projeto. Sem declaracao alguma tambem e global.
  const sym = checker.getSymbolAtLocation(obj)
  const decls = sym?.getDeclarations() ?? []
  return decls.length === 0 || decls.every(declaradoNaLib)
}

/** Chamadas em qualquer profundidade do corpo — para contar emissoes e efeitos. */
/**
 * `ts.forEachChild` INTERROMPE a travessia quando o callback devolve valor
 * truthy — e a versao anterior devolvia o acumulador, entao parava no primeiro
 * filho e via uma chamada de cada corpo. O callback precisa ser void.
 */
const chamadasEm = (node, acc = []) => {
  if (ts.isCallExpression(node)) acc.push(node)
  ts.forEachChild(node, (n) => { chamadasEm(n, acc) })
  return acc
}

/**
 * O metodo e uma EMISSAO PURA da mensagem que recebeu?
 *
 * Exige, de uma vez: um parametro; corpo de expressao unica; essa expressao e
 * `console.<m>(...)` com `console` global; o argumento CONTEM o parametro; e
 * tudo o mais ao redor e literal de decoracao. Uma segunda chamada no corpo
 * (serializacao, efeito colateral, telemetria) reprova, assim como um metodo que
 * ignora a mensagem ou mistura uma segunda fonte textual.
 */
/** Expressão única do corpo: `=> expr`, `{ return expr }` ou `{ expr }`. */
const expressaoUnicaDoCorpo = (fn) => {
  const direto = corpoDeReturnUnico(fn)
  if (direto) return direto
  if (!ts.isBlock(fn.body) || fn.body.statements.length !== 1) return null
  const [st] = fn.body.statements
  return ts.isExpressionStatement(st) ? st.expression : null
}

/**
 * O argumento leva EXATAMENTE a mensagem recebida, decorada só por literais.
 *
 * Duas rejeições distintas: folha `outro` é acesso dinâmico ou efeito, e o
 * conteúdo deixa de ser previsível; mais de um identificador significa segunda
 * fonte textual entrando na frase, e aí a mensagem não é a que chegou.
 */
const argumentoSoLevaAMensagem = (arg, nomeParam) => {
  const folhas = foliasDaExpressao(arg)
  if (folhas.some((f) => f.tipo === "outro")) return false
  const idents = folhas.filter((f) => f.tipo === "ident").map((f) => f.nome)
  return idents.length === 1 && idents[0] === nomeParam
}

/** Um parâmetro nomeado — a mensagem. Aridade diferente não é emissão. */
const temAridadeDeEmissao = (fn) => isFunctionLike(fn)
  && fn.parameters.length === 1 && ts.isIdentifier(fn.parameters[0].name)

function ehEmissaoPura(fn, checker) {
  if (!temAridadeDeEmissao(fn)) return false
  const corpo = expressaoUnicaDoCorpo(fn)
  if (!corpo || !ehEmissaoDeConsole(corpo, checker)) return false
  // UMA emissão e nada mais: a chamada ao console é a única do corpo.
  if (chamadasEm(corpo).length !== 1 || corpo.arguments.length !== 1) return false
  return argumentoSoLevaAMensagem(corpo.arguments[0], fn.parameters[0].name.text)
}

/**
 * O objeto literal e um LOGGER CANONICO LOCAL?
 *
 * `create.js:63` define `defaultLogger` assim, e ele E o canal humano do modulo:
 * o contrato de audiencia esta a vista, no corpo de cada metodo.
 *
 * A versao anterior perguntava apenas "todas as propriedades escrevem em
 * console?" — o que aprovaria um logger que tambem serializa, tem efeito
 * colateral ou concatena conteudo opaco. Aqui cada metodo precisa ser emissao
 * PURA da mensagem recebida, com chave estatica. Uma unica propriedade fora do
 * padrao derruba o objeto inteiro: um meio-logger nao e logger.
 */
export function ehLoggerCanonicoLocal(node, checker) {
  if (!node || !ts.isObjectLiteralExpression(node) || node.properties.length === 0) return false
  if (!checker) return false
  return node.properties.every((p) => {
    const nomeEstatico = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
    if (!nomeEstatico) return false
    if (ts.isMethodDeclaration(p)) return ehEmissaoPura(p, checker)
    return ts.isPropertyAssignment(p) && ehEmissaoPura(p.initializer, checker)
  })
}

/** A propriedade `nome` esta AUSENTE do objeto literal, de forma comprovavel? */
/**
 * A propriedade impede provar a ausência de `nome`?
 *
 * Duas razões distintas, ambas fatais: spread e chave computada trazem o que não
 * está escrito aqui (a ausência deixa de ser verificável), e a própria
 * propriedade `nome` presente significa que ela não está ausente.
 */
const impedeProvaDeAusencia = (p, nome) => {
  if (ts.isSpreadAssignment(p)) return true
  if (!p.name) return false
  if (ts.isComputedPropertyName(p.name)) return true
  return ts.isIdentifier(p.name) && p.name.text === nome
}

export function ausenciaComprovada(node, nome) {
  if (!node || !ts.isObjectLiteralExpression(node)) return false
  return !node.properties.some((p) => impedeProvaDeAusencia(p, nome))
}

const baseDeAtribuicao = (n) => {
  if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null
  const alvo = n.left
  if (ts.isPropertyAccessExpression(alvo) || ts.isElementAccessExpression(alvo)) return alvo.expression
  return alvo
}

const mutaPropriedadeDe = (n, nome) => {
  const alvo = baseDeAtribuicao(n)
  if (!alvo || !ts.isIdentifier(alvo) || alvo.text !== nome) return false
  return ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left)
}

const percorrerNos = (raiz, visitar) => {
  visitar(raiz)
  ts.forEachChild(raiz, (filho) => { percorrerNos(filho, visitar) })
}

/** O identificador e reatribuido ou tem propriedade mutada depois de criado? */
export function sofreMutacao(sf, nome) {
  let mutado = false
  percorrerNos(sf, (n) => { if (mutaPropriedadeDe(n, nome)) mutado = true })
  return mutado
}

// ── Avaliador abstrato (Task 3.1b.1) ─────────────────────────────────────────

/**
 * CINCO VALORES DISTINTOS. `ABSENT` nao pode ser `null` nem `UNRESOLVED`: ele e
 * a PROVA que resolve `options.logger || defaultLogger`. Sem um valor proprio
 * para "a propriedade comprovadamente nao esta la", o fallback seria
 * indistinguivel de "nao sei o que tem la", e o caminho do dispatcher nunca
 * fecharia.
 */
export const AV = Object.freeze({
  ABSENT: Object.freeze({ k: "absent" }),
  UNRESOLVED: Object.freeze({ k: "unresolved" }),
  CONFLICT: Object.freeze({ k: "conflict" }),
})
export const avCanonical = (origin) => Object.freeze({ k: "canonical", origin })
export const avObject = (fields, exact) => Object.freeze({ k: "object", fields, exact })

/** `unresolved` absorve; canonicos iguais mantem; diferentes viram conflict. */
const algumEstado = (a, b, k) => a.k === k || b.k === k

/**
 * Join de valores da MESMA espécie.
 *
 * Canônicos só permanecem canônicos com a mesma origem — origens diferentes são
 * conflito, não "escolha uma". Duas ausências continuam ausência: é a única
 * espécie que se soma sem perder informação. `object` abre, porque comparar
 * campo a campo exigiria um reticulado que esta análise não tem.
 */
const joinMesmaEspecie = (a, b) => {
  if (a.k === "canonical") return a.origin === b.origin ? a : AV.CONFLICT
  return a.k === "absent" ? a : AV.UNRESOLVED
}

const estadoDominanteAv = (a, b) => {
  if (algumEstado(a, b, "unresolved")) return AV.UNRESOLVED
  if (algumEstado(a, b, "conflict")) return AV.CONFLICT
  return null
}

const avAusente = (a, b) => !a || !b

export function joinAv(a, b) {
  if (avAusente(a, b)) return a ?? b
  const dominante = estadoDominanteAv(a, b)
  if (dominante) return dominante
  return a.k === b.k ? joinMesmaEspecie(a, b) : AV.UNRESOLVED
}

const LIMITE_AV = 16

/** Campos de um objeto literal. `exact:false` quando ha spread/chave dinamica. */
/** Nome estático da propriedade, ou `null` quando ela só existe em runtime. */
const nomeEstaticoDaProp = (p) => {
  if (!p.name || ts.isComputedPropertyName(p.name)) return null
  return ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null
}

/**
 * Absorve um spread. Só objeto EXATO já resumido contribui: seus campos entram e
 * a exatidão se preserva. Qualquer outra coisa é desconhecida, e dali em diante
 * não se prova a ausência de campo nenhum.
 */
const absorverSpread = (p, fields, env, ctx, prof) => {
  const v = avaliarExpr(p.expression, env, ctx, prof + 1)
  if (v.k !== "object" || !v.exact) return false
  for (const [k, val] of v.fields) fields.set(k, val)
  return true
}

function camposDoLiteral(node, env, ctx, prof) {
  const fields = new Map()
  let exact = true
  for (const p of node.properties) {
    if (ts.isSpreadAssignment(p)) {
      exact = absorverSpread(p, fields, env, ctx, prof) && exact
      continue
    }
    const nome = nomeEstaticoDaProp(p)
    if (!nome) { exact = false; continue }
    fields.set(nome, avaliarExpr(ts.isPropertyAssignment(p) ? p.initializer : p, env, ctx, prof + 1))
  }
  return avObject(fields, exact)
}

/** `a || b`: so o `ABSENT` comprovado a esquerda deixa o fallback valer. */
function avaliarFallback(node, env, ctx, prof) {
  const esq = avaliarExpr(node.left, env, ctx, prof + 1)
  if (esq.k === "absent") return avaliarExpr(node.right, env, ctx, prof + 1)
  if (esq.k === "canonical") return esq
  return AV.UNRESOLVED
}

/** `obj.campo`: campo do objeto exato, ou `ABSENT` quando comprovadamente falta. */
function avaliarAcesso(node, env, ctx, prof) {
  if (!ts.isIdentifier(node.name)) return AV.UNRESOLVED
  const alvo = avaliarExpr(node.expression, env, ctx, prof + 1)
  if (alvo.k !== "object") return AV.UNRESOLVED
  const v = alvo.fields.get(node.name.text)
  if (v) return v
  // Ausencia so e PROVA quando o objeto e exato: com spread desconhecido, o
  // campo pode estar la sem aparecer aqui.
  return alvo.exact ? AV.ABSENT : AV.UNRESOLVED
}

/** O modulo que define o contrato do canal de diagnostico. */
export const DIAGNOSTIC_ADAPTER_MODULE = "src/cli/diagnostic-logger.js"
const ADAPTER_FN = "normalizeDiagnosticLogger"

const declaracaoDoAdapter = (node, checker) => {
  const sym = checker.getSymbolAtLocation(node)
  if (!sym) return null
  return unalias(checker, sym).getDeclarations()?.[0] ?? null
}

const pertenceAoModuloDoAdapter = (decl) => {
  if (!decl) return false
  return norm(decl.getSourceFile().fileName).endsWith(DIAGNOSTIC_ADAPTER_MODULE)
}

/**
 * A chamada e ao ADAPTER CANONICO, resolvido pelo checker?
 *
 * Nome nao basta: uma funcao local chamada `normalizeDiagnosticLogger` noutro
 * modulo nao e o adapter. A declaracao precisa vir de
 * `src/cli/diagnostic-logger.js`, que e onde o contrato vive e onde a marca de
 * procedencia (WeakSet) e aposta.
 *
 * ESTA E A LINHA QUE SEPARA transporte de bypass. Um logger VALIDO injetado por
 * um chamador e transporte aceito — ele atravessa o adapter e sai com o mesmo
 * contrato de audiencia que o default. O que continua proibido e um helper
 * receber objeto que NAO passou por aqui: nesse caso ninguem verificou os quatro
 * metodos, ninguem congelou o wrapper, e a audiencia da mensagem deixa de ter
 * garantia.
 */
function ehChamadaAoAdapter(node, ctx) {
  if (!ts.isCallExpression(node)) return false
  if (!ts.isIdentifier(node.expression)) return false
  if (node.expression.text !== ADAPTER_FN) return false
  return pertenceAoModuloDoAdapter(declaracaoDoAdapter(node.expression, ctx.checker))
}

/** Identificador: parametro do env, logger canonico local, ou binding. */
const declaracaoInicializada = (d) => Boolean(d) && ts.isVariableDeclaration(d) && Boolean(d.initializer)

const valorDaDeclaracao = (node, d, env, ctx, prof) => {
  if (sofreMutacao(ctx.sf, node.text)) return AV.UNRESOLVED
  if (ehLoggerCanonicoLocal(d.initializer, ctx.checker)) return avCanonical(norm(ctx.sf.fileName))
  return avaliarExpr(d.initializer, env, ctx, prof + 1)
}

function avaliarIdentificador(node, env, ctx, prof) {
  if (env.has(node.text)) return env.get(node.text)
  const d = declaracaoResolvida(ctx.checker, node, ctx.sf)
  if (!declaracaoInicializada(d)) return AV.UNRESOLVED
  // Reatribuicao ou mutacao de propriedade em qualquer ponto do modulo invalida
  // o resumo: o valor lido aqui pode nao ser o valor no momento da chamada.
  return valorDaDeclaracao(node, d, env, ctx, prof)
}

/**
 * Retorno de uma funcao local, avaliado com as declaracoes locais no ambiente.
 *
 * `corpoDeReturnUnico` sozinho nao serve: `resolveCreateCtx` faz
 * `const rt = createRuntime(options); return { logger: rt.logger, … }`, e exigir
 * statement unico descartaria justamente a cadeia real. Aqui as declaracoes
 * `const` sao avaliadas em ordem e entram no ambiente; qualquer outro tipo de
 * statement (if, loop, atribuicao) interrompe — o fluxo deixa de ser linear e o
 * resumo deixaria de descrever o que a funcao devolve.
 */
/** Marca como `UNRESOLVED` todo binding cujo objeto sofre atribuicao no statement. */
function invalidarMutados(st, local) {
  percorrerNos(st, (n) => {
    const base = baseDeAtribuicao(n)
    if (base && ts.isIdentifier(base) && local.has(base.text)) local.set(base.text, AV.UNRESOLVED)
  })
}

/** Liga um `const { a, b: c } = expr` ao ambiente, preservando a identidade do campo. */
const elementoDestructuringSuportado = (el) => !el.dotDotDotToken && ts.isIdentifier(el.name)

const campoDoElemento = (el) =>
  el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text

const valorDoCampo = (fonte, campo) => {
  if (fonte.k !== "object") return AV.UNRESOLVED
  const valor = fonte.fields.get(campo)
  return valor ?? (fonte.exact ? AV.ABSENT : AV.UNRESOLVED)
}

const ligarElementoDestructuring = (el, fonte, local) => {
  if (!elementoDestructuringSuportado(el)) return false
  local.set(el.name.text, valorDoCampo(fonte, campoDoElemento(el)))
  return true
}

function ligarDestructuring(pattern, fonte, local) {
  for (const el of pattern.elements) {
    if (!ligarElementoDestructuring(el, fonte, local)) return false
  }
  return true
}

/** Uma declaracao `const` no ambiente. `false` quando a forma nao e suportada. */
function ligarDeclaracao(d, local, ctx, prof) {
  if (!d.initializer) return false
  if (ts.isIdentifier(d.name)) {
    local.set(d.name.text, avaliarExpr(d.initializer, local, ctx, prof + 1))
    return true
  }
  if (!ts.isObjectBindingPattern(d.name)) return false
  return ligarDestructuring(d.name, avaliarExpr(d.initializer, local, ctx, prof + 1), local)
}

const resultadoDoAmbiente = (local, ret = null) => ({ local, ret })

const corpoEmBloco = (fn) => fn.body && ts.isBlock(fn.body) ? fn.body : null

const retornoDoStatement = (st) => {
  if (!ts.isReturnStatement(st)) return null
  return { encontrou: true, expressao: st.expression ?? null }
}

const ligarStatementLocal = (st, local, ctx, prof) => {
  if (!ts.isVariableStatement(st)) return true
  for (const d of st.declarationList.declarations) {
    if (!ligarDeclaracao(d, local, ctx, prof)) return false
  }
  return true
}

/**
 * Ambiente de uma funcao: parametros mais as declaracoes `const` do corpo,
 * avaliadas em ordem. Para no primeiro statement que nao seja declaracao ou
 * `return` — a partir dali o fluxo deixa de ser linear e o resumo deixaria de
 * descrever o que a funcao faz.
 */
export function ambienteLocal(fn, env, ctx, prof) {
  const local = new Map(env)
  const bloco = corpoEmBloco(fn)
  if (!bloco) return resultadoDoAmbiente(local, fn.body ?? null)
  for (const st of bloco.statements) {
    const retorno = retornoDoStatement(st)
    if (retorno) return resultadoDoAmbiente(local, retorno.expressao)
    // Atribuicao a propriedade de um binding conhecido (`o.logger = outro`)
    // invalida o resumo daquele objeto: o valor que chega na chamada seguinte
    // nao e o que o literal descrevia.
    invalidarMutados(st, local)
    if (!ligarStatementLocal(st, local, ctx, prof)) return resultadoDoAmbiente(local)
  }
  return resultadoDoAmbiente(local)
}

function retornoDaFuncao(fn, env, ctx, prof) {
  const direto = corpoDeReturnUnico(fn)
  if (direto) return { ret: direto, env }
  const { local, ret } = ambienteLocal(fn, env, ctx, prof)
  return { ret, env: local }
}

/** Chamada a funcao local com retorno analisavel: resumo instanciado. */
const alvoLocalDaChamada = (node, ctx) => {
  if (!ts.isIdentifier(node.expression)) return null
  const nome = nomeLocalResolvido(ctx.checker, node.expression, ctx.sf, ctx.decls)
  const fn = nome ? ctx.decls.get(nome) : null
  return fn ? { nome, fn } : null
}

const ambienteDosParametros = (fn, node, env, ctx, prof) => {
  const interno = new Map()
  fn.parameters.forEach((p, i) => {
    if (ts.isIdentifier(p.name)) interno.set(p.name.text, avaliarExpr(node.arguments[i], env, ctx, prof + 1))
  })
  return interno
}

const calcularResumoDaChamada = (alvo, node, env, ctx, prof, chave) => {
  ctx.emCurso.add(chave)
  const interno = ambienteDosParametros(alvo.fn, node, env, ctx, prof)
  const { ret, env: envRet } = retornoDaFuncao(alvo.fn, interno, ctx, prof)
  const resultado = ret ? avaliarExpr(ret, envRet, ctx, prof + 1) : AV.UNRESOLVED
  ctx.emCurso.delete(chave)
  ctx.cache.set(chave, resultado)
  return resultado
}

function avaliarChamada(node, env, ctx, prof) {
  const alvo = alvoLocalDaChamada(node, ctx)
  if (!alvo) return AV.UNRESOLVED
  const chave = `${alvo.nome}#${assinaturaAbstrata(node, env, ctx, prof)}`
  if (ctx.cache.has(chave)) return ctx.cache.get(chave)
  if (ctx.emCurso.has(chave)) return AV.UNRESOLVED
  return calcularResumoDaChamada(alvo, node, env, ctx, prof, chave)
}

/** Assinatura abstrata dos argumentos — chave do cache por chamada. */
const assinaturaAbstrata = (node, env, ctx, prof) => node.arguments
  .map((a) => { const v = avaliarExpr(a, env, ctx, prof + 1); return v.k === "object" ? `o:${[...v.fields.keys()].sort()}:${v.exact}` : v.k })
  .join("|")

const ehFallback = (node) => ts.isBinaryExpression(node)
  && node.operatorToken.kind === ts.SyntaxKind.BarBarToken

const avaliarObjetoAbstrato = (node, env, ctx, prof) =>
  ehLoggerCanonicoLocal(node, ctx.checker)
    ? avCanonical(norm(ctx.sf.fileName))
    : camposDoLiteral(node, env, ctx, prof)

const avaliarCallAbstrato = (node, env, ctx, prof) =>
  ehChamadaAoAdapter(node, ctx)
    ? avCanonical(norm(DIAGNOSTIC_ADAPTER_MODULE))
    : avaliarChamada(node, env, ctx, prof)

const REGRAS_AVALIACAO = [
  { aceita: ts.isParenthesizedExpression, avaliar: (n, e, c, p) => avaliarExpr(n.expression, e, c, p + 1) },
  { aceita: ts.isObjectLiteralExpression, avaliar: avaliarObjetoAbstrato },
  { aceita: ehFallback, avaliar: avaliarFallback },
  { aceita: ts.isPropertyAccessExpression, avaliar: avaliarAcesso },
  { aceita: ts.isCallExpression, avaliar: avaliarCallAbstrato },
  { aceita: ts.isIdentifier, avaliar: avaliarIdentificador },
]

/**
 * Avaliador abstrato de UMA expressao. Toda forma nao coberta cai em
 * `UNRESOLVED` — nao ha caso default otimista.
 */
export function avaliarExpr(node, env, ctx, prof = 0) {
  if (!node || prof > LIMITE_AV) return AV.UNRESOLVED
  const regra = REGRAS_AVALIACAO.find((r) => r.aceita(node))
  return regra ? regra.avaliar(node, env, ctx, prof) : AV.UNRESOLVED
}

/**
 * Valor abstrato de cada PARAMETRO de cada funcao, propagado a partir do
 * entrypoint canonico.
 *
 * A analise comeca EXCLUSIVAMENTE nos handlers do `DISPATCH` que vivem neste
 * arquivo. Exports chamados por testes ou por consumidores diretos nao entram no
 * join: `createProject({ args, logger: outro })` num teste nao pode contaminar a
 * prova do caminho do CLI, e por isso o percurso e dirigido pelas chamadas
 * ALCANCADAS a partir da raiz, nunca por todas as chamadas do modulo.
 *
 * Devolve `Map<"funcao#param", valor>`.
 */
const assinaturaDoAmbiente = (env) => [...env.entries()]
  .map(([k, v]) => `${k}:${v.k}`).sort().join(",")

const prepararPercurso = (ctx, nomeFn, env, prof, visitados) => {
  const fn = ctx.decls.get(nomeFn)
  if (!fn || prof > LIMITE_AV) return null
  const marca = `${nomeFn}(${assinaturaDoAmbiente(env)})`
  if (visitados.has(marca)) return null
  visitados.add(marca)
  return fn
}

const registrarAmbiente = (estado, nomeFn, local) => {
  for (const [nome, valor] of local) {
    const chave = `${nomeFn}#${nome}`
    estado.set(chave, joinAv(estado.get(chave), valor))
  }
}

const chamadaLocal = (chamada, ctx) => {
  if (!ts.isIdentifier(chamada.expression)) return null
  const nome = nomeLocalResolvido(ctx.checker, chamada.expression, ctx.sf, ctx.decls)
  const fn = nome ? ctx.decls.get(nome) : null
  return fn ? { nome, fn } : null
}

const ambienteDaChamada = (chamada, destino, local, ctx, prof) => {
  const filho = new Map()
  destino.parameters.forEach((p, i) => {
    const valor = ehExportada(destino) ? AV.UNRESOLVED : avaliarExpr(chamada.arguments[i], local, ctx, prof + 1)
    if (ts.isIdentifier(p.name)) filho.set(p.name.text, valor)
  })
  return filho
}

const propagarChamadas = (fn, local, ctx, prof, percorrer) => {
  for (const chamada of chamadasEm(fn)) {
    const alvo = chamadaLocal(chamada, ctx)
    if (!alvo) continue
    percorrer(alvo.nome, ambienteDaChamada(chamada, alvo.fn, local, ctx, prof), prof + 1)
  }
}

export function propagarDoEntrypoint(ctx, raizes) {
  const estado = new Map()
  const visitados = new Set()

  const percorrer = (nomeFn, env, prof) => {
    const fn = prepararPercurso(ctx, nomeFn, env, prof, visitados)
    if (!fn) return

    // Parametros MAIS as declaracoes locais: `const c = resolveCreateCtx(o)` e
    // `const { logger } = …` precisam estar no ambiente para que a chamada
    // seguinte seja avaliada com o que o corpo realmente construiu.
    const { local } = ambienteLocal(fn, env, ctx, prof)
    registrarAmbiente(estado, nomeFn, local)

    propagarChamadas(fn, local, ctx, prof, percorrer)
  }

  for (const raiz of raizes) percorrer(raiz, new Map(), 0)
  return estado
}

/**
 * Origem do receptor de `obj.metodo(...)`, lida do estado propagado.
 *
 * `null` quando a chamada nao tem receptor identificador, quando a funcao que a
 * contem nao foi alcancada a partir do entrypoint, ou quando o valor nao e
 * canonico. Ausencia de entrada NAO e permissao: significa que aquele caminho
 * nunca foi percorrido a partir do `DISPATCH`.
 */
/** Valor abstrato de um binding, procurando da função mais interna para fora. */
const valorNaCadeia = (nome, cadeiaDeFuncoes, receptores) => {
  for (const fn of cadeiaDeFuncoes) {
    const v = receptores.get(`${fn}#${nome}`)
    if (v) return v
  }
  return null
}

/**
 * Origem do receptor de `obj.metodo(...)`, lida do estado propagado.
 *
 * Trata DUAS formas de receptor, porque `create.js` usa as duas:
 *
 *   `logger.warn(…)`    — identificador simples, resolvido direto;
 *   `c.logger.info(…)`  — acesso a campo, onde `c` é o objeto do runtime e o
 *                          campo carrega o logger já normalizado.
 *
 * A segunda não é conveniência: sem ela, o mesmo logger provado ficaria
 * `unknown` só por ser lido de um campo em vez de um parâmetro. A prova é a
 * mesma — o valor abstrato do campo — e é ela que decide, nunca o formato.
 *
 * Um `defaultLogger.error(…)` que resolve, pelo binding, ao logger canônico
 * local do módulo também conta: é o mesmo objeto que o adapter normaliza.
 */
/** `logger.warn(…)` — receptor é identificador simples. */
const origemPorIdentificador = (alvo, cadeia, receptores, ctx) => {
  const v = valorNaCadeia(alvo.text, cadeia, receptores)
  if (v) return v.k === "canonical" ? v.origin : null
  // Fora do estado propagado: pode ser o logger canônico do próprio módulo.
  return ctx ? origemDeLoggerLocal(alvo, ctx) : null
}

/** `c.logger.info(…)` — receptor é CAMPO de um objeto já resumido. */
const ehAcessoSimples = (n) => ts.isIdentifier(n.expression) && ts.isIdentifier(n.name)

const origemPorCampo = (alvo, cadeia, receptores) => {
  if (!ehAcessoSimples(alvo)) return null
  const base = valorNaCadeia(alvo.expression.text, cadeia, receptores)
  const campo = base?.k === "object" ? base.fields.get(alvo.name.text) : null
  return campo?.k === "canonical" ? campo.origin : null
}

export function origemDoReceptor(node, cadeiaDeFuncoes, receptores, ctx = null) {
  const c = node.expression
  if (!ts.isPropertyAccessExpression(c)) return null
  const alvo = c.expression
  if (ts.isIdentifier(alvo)) return origemPorIdentificador(alvo, cadeiaDeFuncoes, receptores, ctx)
  if (ts.isPropertyAccessExpression(alvo)) return origemPorCampo(alvo, cadeiaDeFuncoes, receptores)
  return null
}

/**
 * O ponto está DENTRO de um método do logger canônico local?
 *
 * `defaultLogger` é `{ info: (m) => console.log(`  ${m}`), … }`. O `console.log`
 * ali dentro não é uma mensagem: é a IMPLEMENTAÇÃO do canal. O texto vem do
 * chamador — exatamente a mesma semântica de `render-primitive-impl` no módulo
 * canônico, e contá-lo como público duplicaria no inventário a frase que já foi
 * contada no callsite.
 *
 * A prova é `ehLoggerCanonicoLocal` sobre o objeto que contém o método: o mesmo
 * predicado que exige emissão pura em todas as propriedades. Um objeto qualquer
 * com um arrow que chama `console.log` não passa.
 */
function dentroDeLoggerCanonicoLocal(node, ctx) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isObjectLiteralExpression(p)) return ehLoggerCanonicoLocal(p, ctx.checker)
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) return false
  }
  return false
}

/** O identificador resolve, por binding, ao logger canônico local do módulo? */
function origemDeLoggerLocal(id, ctx) {
  const d = declaracaoResolvida(ctx.checker, id, ctx.sf)
  if (!d || !ts.isVariableDeclaration(d) || !d.initializer) return null
  if (sofreMutacao(ctx.sf, id.text)) return null
  return ehLoggerCanonicoLocal(d.initializer, ctx.checker) ? norm(ctx.sf.fileName) : null
}

/** Chamadas a `nome`, no arquivo, com o no da chamada. */
function callsitesDe(sf, nome, checker, decls) {
  const achados = []
  const visitar = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)
      && nomeLocalResolvido(checker, n.expression, sf, decls) === nome) achados.push(n)
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return achados
}

/**
 * A funcao e referenciada sem ser CHAMADA? Callback, atribuicao, export.
 *
 * O teste nao pode ser "o pai e uma CallExpression": em `lista.forEach(emitir)`
 * o pai de `emitir` E uma CallExpression — a do `forEach` —, e `emitir` esta ali
 * como ARGUMENTO. Quem recebeu o callback passa o argumento que quiser, entao os
 * callsites visiveis deixam de esgotar os chamadores. O que caracteriza chamada
 * e o identificador ocupar a posicao de CALLEE.
 */
const ehCalleeDaChamada = (n) => Boolean(n.parent) && ts.isCallExpression(n.parent) && n.parent.expression === n

const ehDeclaracaoDoIdentificador = (n) => Boolean(n.parent)
  && (ts.isFunctionDeclaration(n.parent) || ts.isVariableDeclaration(n.parent))

const referenciaComoValor = (n, nome, checker, sf, decls) => {
  if (!ts.isIdentifier(n) || n.text !== nome) return false
  if (ehCalleeDaChamada(n) || ehDeclaracaoDoIdentificador(n)) return false
  return nomeLocalResolvido(checker, n, sf, decls) === nome
}

function ehUsadaComoValor(sf, nome, checker, decls) {
  let usada = false
  percorrerNos(sf, (n) => {
    if (referenciaComoValor(n, nome, checker, sf, decls)) usada = true
  })
  return usada
}

/** Rest, destructuring ou parametro inexistente tornam a posicao instavel. */
const posicaoEstavel = (fn, nomeParam) =>
  indiceDoParametro(fn, nomeParam) >= 0 && !fn.parameters.some((p) => p.dotDotDotToken)

const indiceDoParametro = (fn, nomeParam) =>
  fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === nomeParam)

const receptorNaoObservavel = (fn, nomeFuncao, nomeParam, ctx) => {
  if (!fn || !posicaoEstavel(fn, nomeParam)) return true
  if (ehExportada(fn)) return true
  return ehUsadaComoValor(ctx.sf, nomeFuncao, ctx.checker, ctx.decls)
}

const agregarCallsites = (chamadas, idx, ctx, profundidade, vistos) => {
  const contribuicao = (c) => contribuicaoDoCallsite(c, idx, ctx, profundidade, vistos)
  return chamadas.map(contribuicao).reduce(joinReceptor, null) ?? RECEPTOR_UNRESOLVED
}

/**
 * Resolve o receptor de um parametro por FIXPOINT sobre os callsites.
 *
 * Cada chamada da funcao contribui com a origem do argumento naquela posicao. Se
 * o argumento e, ele proprio, um parametro de quem chama, a pergunta sobe um
 * nivel — e e por isso que precisa de fixpoint em vez de uma passada.
 *
 * FAIL-CLOSED em cada porta de saida: funcao usada como valor (alguem pode
 * chama-la de fora), parametro com rest/destructuring, callsite sem argumento
 * naquela posicao, e estouro do limite de iteracoes. Todos viram `unresolved`.
 */
export function resolverReceptor(nomeFuncao, nomeParam, ctx, profundidade = 0, vistos = new Set()) {
  const chave = `${nomeFuncao}#${nomeParam}`
  if (profundidade > LIMITE_FIXPOINT) return RECEPTOR_UNRESOLVED
  // Ciclo: a contribuicao deste no ja esta sendo calculada. Devolver `null` o
  // torna neutro no join — o laco nao inventa origem nem derruba as outras.
  if (vistos.has(chave)) return null

  const fn = ctx.decls.get(nomeFuncao)
  if (receptorNaoObservavel(fn, nomeFuncao, nomeParam, ctx)) return RECEPTOR_UNRESOLVED
  // Exportada: o chamador pode estar fora do modulo. Usada como valor: quem
  // recebeu o callback passa o argumento que quiser. Sem chamada: nada observado.
  const idx = indiceDoParametro(fn, nomeParam)
  const chamadas = callsitesDe(ctx.sf, nomeFuncao, ctx.checker, ctx.decls)
  if (chamadas.length === 0) return RECEPTOR_UNRESOLVED

  const proximos = new Set([...vistos, chave])
  return agregarCallsites(chamadas, idx, ctx, profundidade, proximos)
}

/**
 * O que UM callsite diz sobre o receptor.
 *
 * Quando o argumento e, ele proprio, um parametro de quem chama, a pergunta SOBE
 * um nivel — e e por isso que uma passada nao basta e o fixpoint existe.
 */
function contribuicaoDoCallsite(c, idx, ctx, profundidade, vistos) {
  const local = origemDoArgumento(c.arguments[idx], ctx.checker, ctx.sf.fileName)
  if (local.state !== "parameter") return local
  const externa = ancestrais(c).find((f) => ctx.decls.get(f))
  if (!externa) return RECEPTOR_UNRESOLVED
  return resolverReceptor(externa, local.nome, ctx, profundidade + 1, vistos)
}

/** Nomes das funcoes que envolvem o no, de dentro para fora. */
const ancestrais = (node) => {
  const nomes = []
  for (let p = node.parent; p; p = p.parent) if (isFunctionLike(p)) nomes.push(funcName(p))
  return nomes
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
// ── Wrappers de apresentacao (Task 3.1c) ─────────────────────────────────────

/**
 * A funcao e um wrapper TRANSPARENTE de apresentacao?
 *
 * Wrapper transparente e aquele que recebe um texto, o decora e devolve — o
 * conteudo traduzivel atravessa intacto. `monitor.js` tem o caso canonico:
 *
 *   function color(text, code) { return code + text + "\x1b[0m" }
 *
 * Sem resolve-lo, `console.log(color("── Harnesses ──", C.bold))` fica `opaque`
 * e nao ha o que classificar — sao 16 dos 24 pontos daquele arquivo.
 *
 * O RECONHECIMENTO E ESTRUTURAL, NUNCA POR NOME. Qualquer funcao chamada `color`
 * noutro modulo, ou uma que faca I/O, ou uma que componha dois textos, nao passa
 * daqui. Exige-se: corpo de um unico `return`, e a expressao retornada composta
 * apenas de parametros e literais — nada de chamada, nada de acesso a
 * propriedade. Um wrapper que consulta estado nao devolve o que recebeu.
 */
function corpoDeReturnUnico(fn) {
  if (!fn.body) return null
  if (!ts.isBlock(fn.body)) return fn.body
  const stmts = fn.body.statements
  if (stmts.length !== 1 || !ts.isReturnStatement(stmts[0])) return null
  return stmts[0].expression ?? null
}

/** Uma forma por linha; o caminhamento fica em `foliasDaExpressao`. */
const FOLHA_POR_FORMA = [
  [ts.isParenthesizedExpression, (n, acc, rec) => rec(n.expression, acc)],
  [(n) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken,
    (n, acc, rec) => { rec(n.left, acc); rec(n.right, acc) }],
  [ts.isTemplateExpression, (n, acc, rec) => {
    acc.push({ tipo: "literal" })
    for (const s of n.templateSpans) { rec(s.expression, acc); acc.push({ tipo: "literal" }) }
  }],
  [(n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n), (n, acc) => acc.push({ tipo: "literal" })],
  [ts.isIdentifier, (n, acc) => acc.push({ tipo: "ident", nome: n.text })],
]

/** Identificadores e literais que compoem a expressao, sem atravessar chamadas. */
function foliasDaExpressao(node, acc = []) {
  if (!node) return acc
  const caso = FOLHA_POR_FORMA.find(([ehForma]) => ehForma(node))
  // `outro` — chamada, acesso a propriedade, qualquer coisa que possa consultar
  // estado. Uma unica folha dessas derruba a transparencia do wrapper.
  if (caso) caso[1](node, acc, foliasDaExpressao)
  else acc.push({ tipo: "outro" })
  return acc
}

const folhasAceitaveis = (folhas) => folhas.length > 0 && !folhas.some((f) => f.tipo === "outro")

const identsSaoParametros = (usados, nomes) => usados.length > 0 && usados.every((n) => nomes.includes(n))

const ehCandidataAWrapper = (fn) => Boolean(fn) && isFunctionLike(fn) && fn.parameters.length > 0

export function ehWrapperTransparente(fn) {
  if (!ehCandidataAWrapper(fn)) return null
  const ret = corpoDeReturnUnico(fn)
  const folhas = ret ? foliasDaExpressao(ret) : []
  if (!folhasAceitaveis(folhas)) return null

  const nomesDeParametro = fn.parameters.filter((p) => ts.isIdentifier(p.name)).map((p) => p.name.text)
  const usados = folhas.filter((f) => f.tipo === "ident").map((f) => f.nome)
  if (!identsSaoParametros(usados, nomesDeParametro)) return null

  // Indices dos parametros que ATRAVESSAM para a saida. Quem decide qual deles
  // carrega o texto e o CALLSITE, nao esta funcao: `color(texto, cor)` e
  // `color(cor, texto)` tem a mesma forma aqui.
  return { indicesDePassagem: nomesDeParametro.map((n, i) => (usados.includes(n) ? i : -1)).filter((i) => i >= 0) }
}

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
  // `a || b` entrega UM dos lados. Ambos contribuem para a forma: se um deles
  // e frase literal, ha texto a traduzir mesmo quando o outro e opaco.
  [(n) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.BarBarToken,
    (n, acc, rec) => { rec(n.left, acc); rec(n.right, acc) }],
  [ehLiteralDeTexto, (n, acc) => acc.push({ tipo: "literal", texto: n.text })],
]

/**
 * A chamada e a um wrapper transparente DESTE modulo, resolvido por identidade?
 * Devolve o argumento que carrega o texto, ou `null`.
 *
 * A carga tem de ser UNICA: se dois argumentos de passagem sao textuais, o
 * wrapper compoe duas mensagens e nao ha um "o texto" para analisar. Melhor
 * `opaque` do que escolher um deles.
 */
const ehChamadaSimples = (node, ctx) =>
  Boolean(ctx?.checker) && ts.isCallExpression(node) && ts.isIdentifier(node.expression)

const ehTextual = (arg, ctx) => Boolean(arg) && ["text_literal", "text"].includes(formaDoArgumento(arg, ctx).forma)

function cargaDeWrapper(node, ctx) {
  if (!ehChamadaSimples(node, ctx)) return null
  const nome = nomeLocalResolvido(ctx.checker, node.expression, ctx.sf, ctx.decls)
  const forma = nome ? ehWrapperTransparente(ctx.decls.get(nome)) : null
  if (!forma) return null

  const candidatos = forma.indicesDePassagem
    .map((i) => node.arguments[i])
    .filter((arg) => ehTextual(arg, ctx))
  return candidatos.length === 1 ? candidatos[0] : null
}

const empurrarChamada = (node, acc, ctx) => {
  const carga = cargaDeWrapper(node, ctx)
  if (carga) return partesDaExpressao(carga, acc, ctx)
  const dotted = calleeDotted(node)
  if (dotted && SERIALIZADORES.has(dotted)) acc.push({ tipo: "serializador", nome: dotted })
  else acc.push({ tipo: "opaco" })
  return acc
}

function partesDaExpressao(node, acc = [], ctx = null) {
  if (!node) return acc
  const caso = PARTE_POR_FORMA.find(([ehForma]) => ehForma(node))
  if (caso) caso[1](node, acc, (n, a) => partesDaExpressao(n, a, ctx))
  else empurrarChamada(node, acc, ctx)
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
  // Bytes de controle E espaçamento puro caem no mesmo lugar: `logger.info("")`
  // imprime uma linha em branco. Não há palavra a traduzir num separador, e
  // deixá-lo `opaque` o colocaria na fila do que ainda precisa ser investigado.
  [(r) => !r.serializador && !r.temOpaco && (r.soControle || (r.literais.length > 0 && r.soSeparadores)),
    () => ({ forma: "control_only" })],
  [(r) => r.temTexto && !r.temOpaco, () => ({ forma: "text_literal" })],
  [(r) => r.temTexto, () => ({ forma: "text" })],
  /**
   * MOLDURA SEM TEXTO — `console.log(`  ${icon} ${h.id}`)`.
   *
   * Há moldura (os literais existem) mas ela é só espaçamento: nenhum literal
   * tem texto legível. O ponto NAO e ambiguidade — e a diferenca importa. Um
   * `console.log(payload)` e investigacao pendente: nao se sabe o que sai. Este
   * aqui se sabe: sai a composicao de dois dados, sem uma palavra a traduzir.
   *
   * Trata-los como a mesma coisa esconderia um ponto que jamais tera string,
   * dentro da fila do que ainda precisa ser investigado.
   */
  [(r) => !r.temTexto && r.temOpaco && r.literais.length > 0, () => ({ forma: "interpolation_only" })],
]

export function formaDoArgumento(arg, ctx = null) {
  const partes = partesDaExpressao(arg, [], ctx)
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
export const MACHINE_PROTOCOL_CONSUMERS = Object.freeze({
  /**
   * `create --dry-run --json` emite o plano por `process.stdout.write`.
   *
   * O consumidor é REAL e executa o CLI de verdade: `json_purity_contract.test.js`
   * roda `create amostra --dry-run --json`, exige que stdout seja um documento
   * JSON puro e que o payload não vaze pelo stderr. Não é um mock do formato — é
   * um parser sobre a saída do processo.
   */
  "src/cli/create.js": Object.freeze({
    consumer: "json_purity_contract",
    proof: "tests/json_purity_contract.test.js — `create amostra --dry-run --json` na lista SUCESSO",
  }),
})

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

const ehFraseHumana = (p) => p.underMachineGuard !== true && (
  p.argForm === "text_literal"
  // Moldura INTERPOLADA so vira canal humano com entrypoint canonico provado.
  // Com "export qualquer" bastaria, e o `select` de SQL — literal + parametro,
  // exatamente esta forma — voltaria a ser classificado como saida do CLI.
  // `interpolation_only` acompanha `text`: sem moldura a traduzir, mas o CANAL
  // e a mesma pergunta, e a resposta exige o mesmo entrypoint canonico.
  || (["text", "interpolation_only"].includes(p.argForm) && p.reachableFromEntrypoint === true))

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
    /**
     * Receptor com origem CANONICA PROVADA (3.1b.1).
     *
     * `logger.warn("...")` onde o avaliador abstrato provou, a partir do
     * `DISPATCH`, que `logger` e o logger canonico do modulo. O nome `logger`, o
     * metodo `warn` e a literalidade do argumento continuam nao valendo nada
     * sozinhos — o que vale e a origem propagada.
     */
    /**
     * Receptor canônico emitindo só espaçamento — `logger.info("")` imprime uma
     * linha em branco. O canal é o humano, mas não há palavra a traduzir, e é
     * `terminal_control` que descreve isso: ausência de idioma, não ausência de
     * classificação.
     */
    /**
     * Metodo do logger canonico LOCAL — `defaultLogger.info` e companhia. Mesma
     * razao de `render-primitive-impl` no modulo canonico: a funcao so decora, e
     * contar como publico duplicaria a frase ja contada no callsite.
     */
    id: "local-render-primitive-impl",
    when: (p) => p.inLocalRenderPrimitive === true && p.binding.kind === "global",
    audience: "render_primitive",
    trigger: "channel_implementation",
    reason: "console.* dentro de metodo do logger canonico local: implementa o canal, o texto vem do chamador",
  },
  {
    id: "canonical-receiver-spacing",
    when: (p) => Boolean(p.receiverOrigin) && p.argForm === "control_only" && p.underMachineGuard !== true,
    audience: "terminal_control",
    trigger: "control_bytes",
    reason: "receptor canonico com argumento de puro espacamento ou controle: nao ha idioma numa linha em branco",
  },
  {
    id: "canonical-receiver",
    when: (p) => Boolean(p.receiverOrigin) && p.underMachineGuard !== true
      && ["text_literal", "text", "interpolation_only"].includes(p.argForm),
    audience: "public_diagnostic",
    trigger: "proved_receiver",
    reason: "receptor com origem canonica provada por avaliacao abstrata a partir do entrypoint do DISPATCH",
  },
  {
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
/**
 * Consumidor declarado para o arquivo — casamento por caminho RELATIVO AO ROOT.
 *
 * Sufixo não serve: um fixture em `tmpdir` cujo caminho termine em
 * `src/cli/create.js` herdaria o consumidor declarado do repositório, e um teste
 * hostil que exige `unknown` passaria a receber `machine_protocol`. Quem sabe
 * qual é a raiz é o gerador; ele passa `ctx.repoRoot`, e sem isso a comparação é
 * por igualdade estrita.
 */
/**
 * Chave CANÔNICA do arquivo: caminho relativo à raiz do projeto.
 *
 * A tabela de consumidores é declarada por caminho de repositório
 * (`src/cli/create.js`), e o gerador analisa por caminho absoluto. Reduzir os
 * dois à mesma chave é o que permite comparar por IGUALDADE — sufixo, basename
 * ou substring fariam um arquivo homônimo fora do projeto herdar o consumidor.
 *
 * `null` quando o arquivo não está contido na raiz: fora do projeto não há chave
 * canônica, e portanto não há consumidor.
 */
const chaveCanonica = (arquivo, repoRoot) => {
  const alvo = norm(arquivo)
  if (!repoRoot) return alvo
  const raiz = norm(repoRoot).replace(/\/+$/, "")
  if (!alvo.startsWith(`${raiz}/`)) return null
  const rel = alvo.slice(raiz.length + 1)
  // Contenção: `..` no relativo significa que o caminho escapa do projeto.
  return rel.split("/").includes("..") ? null : rel
}

const consumidorDe = (arquivo, consumers, repoRoot = null) => {
  const chave = chaveCanonica(arquivo, repoRoot)
  return chave ? ((consumers ?? {})[chave] ?? null) : null
}

/**
 * MODO do ponto — qual ramo do comando ele serve.
 *
 * `--json` e o ramo de maquina, detectado por `underMachineGuard` (a guarda
 * estrutural, nao a string "--json" no texto). Fora dele o ponto e saida humana,
 * e uma prova de `--json` nao fala sobre ele.
 */
export const MODO_JSON = "--json"
const modoDoPonto = (p) => (p.underMachineGuard === true ? MODO_JSON : null)

/**
 * ANCORA FINA para modulo COMPARTILHADO: arquivo + comando + modo.
 *
 * `runtime-supervisor.js` e alcancado por `dev`, `stop`, `logs` e `open`. Declarar
 * o ARQUIVO cobriria os quatro com a prova de dois — a mesma doenca da cobertura
 * por nome de sink, um nivel acima. Aqui a unidade de prova identifica qual
 * comando, em qual ramo, com qual consumidor e qual evidencia.
 *
 * UNIVERSAL, nao existencial: TODA rota que chega ao ponto precisa estar provada.
 * Duas rotas convergentes cobrem so a intersecao realmente provada — se `dev`
 * (provado) e `logs` (nao provado) alcancam o mesmo ponto, o ponto NAO e coberto,
 * porque rodar `logs` executa aquela escrita sem nenhum consumidor que a leia.
 *
 * Fail-closed em cada porta: sem comando derivado do DISPATCH, com modo diferente
 * do provado, ou com entrada sem `command`/`consumer`/`evidence`, nao cobre.
 */
const declaracaoCobre = (d, comando, modo) =>
  d && d.command === comando && d.mode === modo && Boolean(d.consumer) && Boolean(d.evidence)

function coberturaAncorada(entrada, p) {
  const declaradas = entrada.commands
  if (!Array.isArray(declaradas) || declaradas.length === 0) return false
  const comandos = p.commands ?? []
  // Handler compartilhado sem rota provada, ponto fora de qualquer handler do
  // DISPATCH, chamada dinamica: nada a casar, permanece unknown.
  if (comandos.length === 0) return false
  const modo = modoDoPonto(p)
  return comandos.every((c) => declaradas.some((d) => declaracaoCobre(d, c, modo)))
}

/**
 * Consumidor provado para o ponto, nas DUAS formas:
 *
 *   file-scoped  `{ consumer, proof }`      — contrato existente, inalterado.
 *                                             Exato quando o arquivo inteiro
 *                                             serve um comando so (`create.js`).
 *   ancorada     `{ commands: [{ command, mode, consumer, evidence }] }`
 *                                           — para modulo compartilhado.
 *
 * A forma ancorada e escolhida pela presenca de `commands`; nada muda para quem
 * ja declarava por arquivo.
 */
const consumidorProvado = (p, ctx) => {
  const entrada = consumidorDe(p.file, ctx.consumers, ctx.repoRoot)
  if (!entrada) return false
  return Array.isArray(entrada.commands) ? coberturaAncorada(entrada, p) : true
}

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
    // Casa por SUFIXO: o gerador analisa por caminho absoluto e o registro de
    // consumidores é declarado por caminho de repositório. Comparar por igualdade
    // fazia o mesmo ponto ser `machine_protocol` na análise direta e `unknown` no
    // registry — divergência silenciosa entre o que se mede e o que se publica.
    when: (p, ctx) => p.argForm === "serializer" && consumidorProvado(p, ctx),
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
  // FRONTEIRA DE REPRESENTAÇÃO. `repoRoot` chega como o SO o entrega (`C:\…` no
  // Windows) e `p.file` já passou por `norm` (`C:/…`). Canonicalizar aqui, uma
  // vez, é o que mantém a comparação estrita adiante — a alternativa seria
  // afrouxar o casamento, e aí um arquivo homônimo fora do projeto herdaria o
  // consumidor declarado.
  const base = {
    consumers: ctx.consumers ?? MACHINE_PROTOCOL_CONSUMERS,
    repoRoot: ctx.repoRoot ? norm(ctx.repoRoot) : null,
  }
  return aplicar(p.sink ? SINK_RULES : JS_RULES, p, base)
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
  // Raizes DERIVADAS do DISPATCH real; vazio quando nao provado.
  const canonicas = entrypointsCanonicos(a.program, a.checker).get(norm(filePath)) ?? null
  const alcanceCanonico = canonicas ? alcancaveisDeExport(a.checker, sf, canonicas) : { alcancadas: new Set() }
  // Alcance POR COMANDO, nao pela uniao dos handlers: e o que permite dizer que
  // um ponto pertence a `dev` e nao a `logs` dentro do mesmo arquivo.
  const alcancePorComando = alcancePorComandoDe(a.checker, sf,
    entrypointsPorComando(a.program, a.checker).get(norm(filePath)))
  // Contexto de resolucao para wrappers transparentes (3.1c): mesmo grafo de
  // declaracoes locais da 3.1a, entao a identidade de no ja esta conferida.
  const ctxAst = { checker: a.checker, sf, decls: declaracoesDeFuncao(sf), cache: new Map(), emCurso: new Set() }
  // Valor abstrato de cada parametro, propagado SO a partir dos handlers do
  // DISPATCH que vivem neste arquivo (3.1b.1).
  const receptores = propagarDoEntrypoint(ctxAst, canonicas ?? [])

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
      // Criterio ESTRITO: so handler do DISPATCH conta como origem.
      reachableFromEntrypoint: alcancavelDaqui(ancestry(node).functions, alcanceCanonico),
      // Comandos canonicos que alcancam o ponto — a ancora fina da prova de
      // consumidor. Vazio quando nenhum handler do DISPATCH chega aqui.
      commands: comandosQueAlcancam(ancestry(node).functions, alcancePorComando),
      // Origem do RECEPTOR quando a chamada e `obj.metodo(...)`: consulta o
      // valor propagado para aquele parametro, na funcao que contem o ponto.
      receiverOrigin: origemDoReceptor(node, ancestry(node).functions, receptores, ctxAst),
      // Implementacao do canal, nao mensagem: o texto vem do chamador.
      inLocalRenderPrimitive: dentroDeLoggerCanonicoLocal(node, ctxAst),
      templateIds: templateIdentifiers(arg0),
      argKind: arg0 ? ts.SyntaxKind[arg0.kind] : "none",
      // Forma ESTRUTURAL do argumento — o que permite decidir sobre um
      // `process.*.write` sem apelar para a identidade do arquivo.
      argForm: formaDoArgumento(arg0, ctxAst).forma,
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
  // AUSENCIA DE MOLDURA LOCAL nao e ausencia de provenance. Aqui nao ha frase a
  // traduzir — so espacamento entre dados —, e por isso a estrategia
  // `translate_literal_frame_preserve_interpolations` nao se aplica: nao existe
  // frame literal. Os `ids` seguem preservados porque dado dinamico continua
  // exigindo prova estrutural ou decisao ancorada; o que muda e a RAZAO de
  // `resolved: false`, nunca o fato de haver algo a decidir.
  if (p.argForm === "interpolation_only") return { resolved: false, kind: "no_local_frame", ids: p.templateIds }
  return { resolved: false, kind: "interpolated", ids: p.templateIds }
}
