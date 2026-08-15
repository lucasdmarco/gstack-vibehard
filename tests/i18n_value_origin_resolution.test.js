import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import ts from "typescript"

/**
 * PROVA INDIVIDUAL da origem, ponto a ponto — a segunda camada de
 * `translate_at_value_origin`.
 *
 * O loader (runtime, ZERO TypeScript por contrato) valida forma, listas
 * fechadas, ancora exata e hash da origem. Ele NAO consegue responder as duas
 * perguntas que decidem se a estrategia cabe:
 *
 *   a origem RESOLVE para um literal de verdade, linguisticamente traduzivel?
 *   ha UMA so origem possivel?
 *
 * Isso exige ler codigo, nao JSON, e e o que este arquivo faz — com o mesmo
 * checker do engine, contra o repositorio REAL. Nome de variavel, propriedade ou
 * metodo nao vale como evidencia: o que vale e a declaracao resolvida.
 *
 * CRITERIO DE "TRADUZIVEL", declarado e conservador: o literal precisa ser uma
 * FRASE — ter letras e mais de um token. `"active"` e `"not_yet_vendored"` sao
 * tokens de enum e NAO passam, ainda que sejam strings. Uma frase legitima de
 * uma palavra so seria recusada; a recusa e o lado seguro do erro.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const reg = () => import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)

const OVERRIDES = path.join(repoRoot, "src", "meta", "i18n-js-overrides.json")
const rel = (f) => path.relative(repoRoot, f).replace(/\\/g, "/")

let programa = null
async function analisador() {
  if (programa) return programa
  const { CONVERTED_FILES } = await reg()
  const alvos = [...new Set([...CONVERTED_FILES,
    "src/commands/visual.js", "src/commands/research.js", "src/commands/context.js"])]
  const program = ts.createProgram(alvos.map((f) => path.join(repoRoot, f)), {
    allowJs: true, checkJs: false, noEmit: true,
    target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  })
  programa = { program, checker: program.getTypeChecker() }
  return programa
}

/** Acesso a propriedade `<expr>.<nome>` na linha pedida. */
function acessoNaLinha(sf, linha, nome) {
  let achado = null
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === nome) {
      const p = sf.getLineAndCharacterOfPosition(n.getStart(sf))
      if (p.line + 1 === linha) achado = n
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return achado
}

/**
 * Origens DISTINTAS de uma propriedade, deduplicadas por posicao.
 *
 * O checker devolve a mesma declaracao mais de uma vez quando o tipo e uniao de
 * objetos que convergem para ela; contar sem deduplicar acusaria "duas origens"
 * onde ha uma. Deduplicar por (arquivo, linha, coluna) e o que separa
 * convergencia real de repeticao do checker.
 */
function origensDe(checker, acesso) {
  const sym = checker.getSymbolAtLocation(acesso)
  const decls = sym ? (sym.getDeclarations() ?? []) : []
  const porPosicao = new Map()
  for (const d of decls) {
    const sf = d.getSourceFile()
    const p = sf.getLineAndCharacterOfPosition(d.getStart(sf))
    const chave = `${rel(sf.fileName)}|${p.line + 1}|${p.character + 1}`
    if (!porPosicao.has(chave)) {
      porPosicao.set(chave, {
        file: rel(sf.fileName), line: p.line + 1, column: p.character + 1,
        initializer: ts.isPropertyAssignment(d) ? d.initializer : null,
      })
    }
  }
  return [...porPosicao.values()]
}

/** FRASE, nao token: tem letra e mais de um token separado por espaco. */
const ehFrase = (texto) => /\p{L}/u.test(texto) && texto.trim().split(/\s+/).length > 1

const literalDeFrase = (o) => Boolean(o.initializer)
  && ts.isStringLiteral(o.initializer)
  && ehFrase(o.initializer.text)

async function origensNoPonto(arquivo, linha, propriedade) {
  const { program, checker } = await analisador()
  const sf = program.getSourceFile(path.join(repoRoot, arquivo))
  assert.ok(sf, `${arquivo} não está no programa`)
  const acesso = acessoNaLinha(sf, linha, propriedade)
  assert.ok(acesso, `${arquivo}:${linha} não tem acesso a \`.${propriedade}\` — reancorar o teste`)
  return origensDe(checker, acesso)
}

// ── POSITIVO: visual.js:97 ──────────────────────────────────────────────────

test("POSITIVO visual.js:97 — `rule.description` resolve para UMA frase, no projeto", async () => {
  const origens = await origensNoPonto("src/commands/visual.js", 97, "description")

  assert.equal(origens.length, 1,
    `duas origens possíveis bloqueiam: ${origens.map((o) => `${o.file}:${o.line}`).join(", ")}`)
  const [o] = origens
  assert.equal(o.file, "src/skills/design-rule-registry.js", "a origem é módulo do projeto")
  assert.ok(literalDeFrase(o), "a origem precisa ser um literal de FRASE, não um token")
  assert.ok(!/node_modules/.test(o.file) && !o.file.endsWith(".d.ts"), "origem externa bloqueia")
})

test("a decisão declarada para visual.js:97 aponta para a origem REAL, linha e coluna", async () => {
  const [o] = await origensNoPonto("src/commands/visual.js", 97, "description")
  const decisoes = JSON.parse(readFileSync(OVERRIDES, "utf8")).provenanceDecisions
  const d = decisoes.find((x) => x.file === "src/commands/visual.js" && x.line === 97)
  if (!d) return // ainda não aplicada; o teste de aplicação vive no commit da conversão

  assert.equal(d.strategy, "translate_at_value_origin")
  for (const v of Object.values(d.values)) {
    assert.equal(v.origin.file, o.file, "arquivo de origem declarado ≠ resolvido")
    assert.equal(v.origin.line, o.line, "linha de origem declarada ≠ resolvida")
    assert.equal(v.origin.column, o.column, "coluna de origem declarada ≠ resolvida")
  }
})

// ── NEGATIVOS REAIS, tirados do próprio repositório ─────────────────────────

/**
 * DUAS ORIGENS POSSIVEIS — `rule.status`, no MESMO callsite do positivo.
 *
 * O registro de regras tem entradas `active` e `not_yet_vendored`, e o checker
 * resolve `status` para as DUAS. Nao ha origem unica a ancorar, e por isso a
 * estrategia nao se aplica — ainda que tudo o mais se pareca com o caso bom.
 */
test("NEGATIVO real: `rule.status` tem DUAS origens possíveis — não ancorável", async () => {
  const origens = await origensNoPonto("src/commands/visual.js", 96, "status")
  assert.ok(origens.length > 1,
    "se este símbolo passasse a ter origem única, o controle perdeu o objeto e precisa ser reancorado")
})

/**
 * ORIGEM NAO LINGUISTICA — os literais de `status` sao `"active"` e
 * `"not_yet_vendored"`: tokens de enum. Strings, mas nao frases.
 */
test("NEGATIVO real: as origens de `rule.status` são TOKENS, não frases", async () => {
  const origens = await origensNoPonto("src/commands/visual.js", 96, "status")
  for (const o of origens) {
    assert.equal(literalDeFrase(o), false,
      `${o.file}:${o.line} é token de enum; aceitá-lo como frase abriria a estratégia para identificador`)
  }
})

/**
 * ORIGEM NAO RESOLVIDA — `p.message` em `research.js:195`.
 *
 * `p` e parametro de arrow sem tipo, entao o checker nao resolve `message` e
 * devolve ZERO declaracoes. Ler o codigo com os olhos mostra a frase em
 * `src/tools/notebooklm.js`, mas LER NAO E PROVAR: o ponto 7 do contrato manda
 * bloquear origem nao resolvida, e e o que acontece. Por isso `research.js:195`
 * NAO recebe esta estrategia.
 */
test("NEGATIVO real: `p.message` em research.js:195 NÃO resolve — bloqueia", async () => {
  const origens = await origensNoPonto("src/commands/research.js", 195, "message")
  assert.equal(origens.length, 0,
    "se passar a resolver, reavaliar: o ponto vira candidato e o bloqueio deixa de valer")
})

/**
 * ORIGEM EXTERNA AO PROJETO — `d.evidence` em `context.js:201` vem de
 * `out.results` do context scout, isto e, dos documentos INDEXADOS DO USUARIO.
 * Nao ha declaracao no projeto a ancorar, e o conteudo nem e nosso.
 */
test("NEGATIVO real: `d.evidence` em context.js:201 NÃO resolve — conteúdo do usuário", async () => {
  const origens = await origensNoPonto("src/commands/context.js", 201, "evidence")
  assert.equal(origens.length, 0,
    "origem dinâmica/externa bloqueia — este ponto pede `user_content`, não esta estratégia")
})

// ── DECLARADA MAS NAO APLICADA ──────────────────────────────────────────────

/**
 * Toda decisao desta estrategia precisa ter EFEITO no inventario oficial.
 * Declarar sem aplicar seria anunciar uma decisao que nao governa nada — o
 * mesmo defeito que `declared === applied` ja guarda para o conjunto todo, aqui
 * afirmado para a estrategia nova em particular.
 */
test("toda decisão `translate_at_value_origin` declarada é APLICADA no inventário", async () => {
  const { buildInventory } = await import(
    pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js")).href)
  const decisoes = JSON.parse(readFileSync(OVERRIDES, "utf8")).provenanceDecisions
  const daEstrategia = decisoes.filter((d) => d.strategy === "translate_at_value_origin")

  const inv = await buildInventory({ repoRoot })
  for (const d of daEstrategia) {
    const p = inv.points.find((x) =>
      String(x.file).replace(/\\/g, "/") === d.file && x.line === d.line && x.column === d.column)
    assert.ok(p, `${d.file}:${d.line}:${d.column} declarado mas o ponto não existe no inventário`)
    assert.ok(p.provenanceDecision, `${d.file}:${d.line} declarado mas NÃO aplicado`)
    assert.equal(p.provenanceDecision.strategy, "translate_at_value_origin")
  }
})
