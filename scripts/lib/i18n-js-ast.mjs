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

/** `console` nao tem declaracao no programa: e global do runtime. */
const CONSOLE_BINDING = Object.freeze({ kind: "global", declaredIn: null })

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

/** Env vars que constituem ativacao explicita de depuracao. */
const DEBUG_ENV_VARS = new Set(["GSTACK_DEBUG", "DEBUG", "VERBOSE"])

/**
 * A expressao e ESTRUTURALMENTE `process.env.<VAR_APROVADA>`?
 *
 * A 1a versao fazia regex sobre o texto da condicao e aceitava qualquer coisa
 * contendo "DEBUG" — inclusive `options.DEBUG`, `isDebugMode`, ou uma string.
 * Isso e heuristica textual, exatamente o sinal que esta fase existe para nao
 * usar. Aqui a arvore precisa ser `process` → `.env` → `.VAR`.
 */
/** O no e exatamente `process.env`? Nem `cfg.env`, nem `process.argv`. */
const ehProcessEnv = (n) => ts.isPropertyAccessExpression(n)
  && ts.isIdentifier(n.name) && n.name.text === "env"
  && ts.isIdentifier(n.expression) && n.expression.text === "process"

/** O identificador da propriedade e uma das env vars aprovadas? */
const ehVarDebug = (n) => ts.isIdentifier(n) && DEBUG_ENV_VARS.has(n.text)

/** `!process.env.X` guarda a mesma decisao que `process.env.X`. */
const semNegacao = (e) => (ts.isPrefixUnaryExpression(e) ? e.operand : e)

export function isDebugEnvAccess(expr) {
  const e = semNegacao(expr)
  if (ts.isBinaryExpression(e)) return isDebugEnvAccess(e.left) || isDebugEnvAccess(e.right)
  if (!ts.isPropertyAccessExpression(e)) return false
  return ehVarDebug(e.name) && ehProcessEnv(e.expression)
}

/** `filho` esta contido em `alvo` por POSICAO na arvore? */
const contains = (alvo, filho) => Boolean(alvo)
  && filho.getStart() >= alvo.getStart() && filho.getEnd() <= alvo.getEnd()

/**
 * O ponto esta sob guarda de ativacao explicita de debug?
 *
 * Tres exigencias, todas ausentes na 1a versao:
 *   1. condicao ESTRUTURALMENTE `process.env.<VAR>` (nao regex de texto);
 *   2. o no precisa estar no ramo THEN — uma chamada no `else` roda quando o
 *      debug esta DESLIGADO, e classifica-la como debug seria o oposto;
 *   3. ancestralidade real — guard em funcao vizinha nao alcanca.
 */
export function underDebugGuard(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (isFunctionLike(p)) break
    if (!ts.isIfStatement(p)) continue
    if (!isDebugEnvAccess(p.expression)) continue
    if (contains(p.thenStatement, node)) return true
    // No ramo `else` (ou fora do then): NAO e caminho de debug.
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
])

export function classifyPoint(p) {
  const r = JS_RULES.find((x) => x.when(p))
  if (!r) return { audience: "unknown", trigger: null, rule: null }
  return { audience: r.audience, trigger: r.trigger, rule: r.id }
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

export function analyzeFile(filePath, analyzer = null) {
  const a = analyzer || createAnalyzer([filePath])
  const sf = a.program.getSourceFile(filePath)
  if (!sf) throw new Error(`arquivo nao esta no programa: ${filePath}`)
  const pontos = []

  const registrar = (node, alvo, canonicalName, binding) => {
    const arg0 = node.arguments[0]
    const base = {
      file: norm(filePath),
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      name: alvo.name,
      // Nome DECLARADO — e ele que decide o que a chamada e, nao o apelido local.
      canonicalName,
      callee: alvo.objeto ? `${alvo.objeto}.${alvo.name}` : alvo.name,
      binding,
      ...ancestry(node),
      underDebugGuard: underDebugGuard(node),
      templateIds: templateIdentifiers(arg0),
      argKind: arg0 ? ts.SyntaxKind[arg0.kind] : "none",
    }
    pontos.push({ ...base, ...classifyPoint(base) })
  }

  /** `console` e global do runtime: nao ha simbolo de projeto a resolver. */
  const resolverAlvo = (alvo) => {
    if (alvo.objeto === "console") return { binding: CONSOLE_BINDING, canonicalName: alvo.name }
    return {
      binding: resolveBinding(a.checker, alvo.idNode, filePath),
      canonicalName: canonicalNameOf(a.checker, alvo.idNode) ?? alvo.name,
    }
  }

  /**
   * RESOLVE PRIMEIRO, filtra depois. A 1a versao filtrava por `SINK_NAMES` no
   * nome LOCAL e perdia todo alias arbitrario antes mesmo de resolver.
   */
  const descreverChamada = (node) => {
    const alvo = calleeInfo(node.expression)
    if (!alvo) return null
    const r = resolverAlvo(alvo)
    return SINK_NAMES.has(r.canonicalName) ? { alvo, ...r } : null
  }

  const visit = (node) => {
    const ponto = ts.isCallExpression(node) ? descreverChamada(node) : null
    if (ponto) registrar(node, ponto.alvo, ponto.canonicalName, ponto.binding)
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
