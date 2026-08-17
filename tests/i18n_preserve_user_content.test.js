import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * `preserve_user_content_verbatim` — valor linguístico que pertence ao USUÁRIO.
 *
 * A quarta estratégia do vocabulário, e a única cujo destino é "não traduzir em
 * lugar nenhum". As outras três dizem ONDE traduzir (na moldura, ou na origem)
 * ou por que NÃO HÁ o que traduzir (valor não linguístico). Esta diz que o texto
 * É linguístico, seria traduzível em tese, e mesmo assim não é nosso para
 * traduzir.
 *
 * NASCEU DE UM PONTO QUE NENHUMA DAS TRÊS DESCREVIA SEM MENTIR —
 * `context.js:201` interpola um trecho de documento indexado do usuário numa
 * moldura que só tem espaços. `preserve_nonlinguistic_dynamic_values` exigiria
 * chamar prosa de `glyph`/`identifier`/`control`;
 * `translate_at_value_origin` exigiria ancorar a origem num literal do projeto,
 * que não existe — o texto nasce em runtime.
 *
 * O RISCO DELA É SER ATALHO: "é do usuário" tira o ponto da claim, e se bastasse
 * afirmá-lo, qualquer frase inconveniente sairia por aqui. Daí as portas —
 * audiência ANTES da decisão, espécie e fronteira em listas fechadas, e a
 * proibição de `translationSite`, que diria o oposto do que ela significa.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const url = (p) => pathToFileURL(path.join(repoRoot, p)).href
const loader = () => import(`${url("src/meta/i18n-js-registry-loader.js")}?t=${Date.now()}`)
const gen = () => import(`${url("scripts/i18n-registry.mjs")}?t=${Date.now()}`)

const ALVO = "src/cli/index.js"

/**
 * Fonte com UM ponto sem moldura linguística: os literais do template são só
 * indentação, e o valor interpolado é um trecho lido de fora. É a mesma forma de
 * `context.js:201`.
 */
const FONTE = `export function info(m) { console.log(m) }
export function render(d) {
  info(\`      \${String(d.evidence || "").slice(0, 120)}\`)
}
`

/** Projeto real em disco, com override e decisões configuráveis. */
async function projeto({ decisoes = [], overrides = [] } = {}) {
  const { buildRegistry, serializar } = await gen()
  const root = mkdtempSync(path.join(tmpdir(), "gstack-usercontent-"))
  mkdirSync(path.join(root, "src", "meta"), { recursive: true })
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, ALVO), FONTE)

  const reg = buildRegistry([ALVO], { root })
  writeFileSync(path.join(root, "src/meta/i18n-js-registry.json"), serializar(reg))
  writeFileSync(path.join(root, "src/meta/i18n-js-overrides.json"), JSON.stringify({
    schema: "gstack.i18n-js-overrides.v1", overrides, provenanceDecisions: decisoes,
  }, null, 2))

  const dados = reg.files[ALVO]
  const alvo = dados.entries.find((e) => e.provenance.resolved === false)
  return { root, hash: dados.fileHash, alvo }
}

const overrideUserContent = (ctx, audience = "user_content") => ({
  file: ALVO, line: ctx.alvo.line, column: ctx.alvo.column,
  audience, expectedFileHash: ctx.hash,
  reason: "o valor é um trecho de documento do usuário; o canal não é do produto",
  owner: "teste", evidence: "tests/i18n_preserve_user_content.test.js",
})

const valorDoUsuario = (id) => ({
  id, sourceKind: "indexed_user_document", boundary: "subprocess_stdout",
  reason: `\`${id}\` carrega o trecho lido do índice do usuário`,
  owner: "teste", evidence: "fixture da estratégia",
})

const decisao = (ctx, extra = {}) => ({
  file: ALVO, line: ctx.alvo.line, column: ctx.alvo.column,
  expectedFileHash: ctx.hash,
  strategy: "preserve_user_content_verbatim",
  interpolations: [...ctx.alvo.provenance.ids],
  reason: "Não há moldura: os literais do template são só indentação. O valor é prosa, mas é do USUÁRIO — trecho de um documento que ele indexou. Não se traduz aqui nem em lugar nenhum.",
  owner: "teste",
  evidence: "tests/i18n_preserve_user_content.test.js",
  values: Object.fromEntries(ctx.alvo.provenance.ids.map((id) => [id, valorDoUsuario(id)])),
  ...extra,
})

/** Roda o loader real contra o projeto e devolve o veredito. */
async function veredito(ctx) {
  const { loadJsRegistry } = await loader()
  return loadJsRegistry({ repoRoot: ctx.root })
}

const comProjeto = async (t, opcoes, fn) => {
  const base = await projeto()
  const ctx = await projeto(opcoes(base))
  cleanupTmp(base.root)
  t.after(() => cleanupTmp(ctx.root))
  return fn(await veredito(ctx), ctx)
}

const reprova = (v, padrao) => {
  assert.equal(v.ok, false, "a decisão precisava ser recusada e passou")
  assert.match(v.reason ?? "", padrao)
}

// ── O ponto de partida: a forma existe e é `no_local_frame` ────────────────

test("o fixture produz um ponto SEM moldura, com provenance não resolvida", async (t) => {
  const ctx = await projeto()
  t.after(() => cleanupTmp(ctx.root))
  assert.equal(ctx.alvo.provenance.kind, "no_local_frame")
  assert.equal(ctx.alvo.provenance.resolved, false)
})

test("a estratégia entrou no vocabulário e SÓ no kind sem moldura", async () => {
  const { PROVENANCE_STRATEGIES, STRATEGY_BY_KIND } = await loader()
  assert.ok(PROVENANCE_STRATEGIES.includes("preserve_user_content_verbatim"))
  assert.ok(STRATEGY_BY_KIND.no_local_frame.includes("preserve_user_content_verbatim"))
  assert.ok(!STRATEGY_BY_KIND.interpolated.includes("preserve_user_content_verbatim"),
    "com moldura linguística a pergunta é outra: há frase do projeto a traduzir")
})

// ── POSITIVO ────────────────────────────────────────────────────────────────

test("POSITIVO: audiência `user_content` + decisão com espécie e fronteira passa", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [overrideUserContent(b)], decisoes: [decisao(b)] }), (v) => {
    assert.equal(v.ok, true, v.reason ?? "")
  })
})

test("POSITIVO: a provenance BRUTA continua `resolved:false` — a decisão fica ao lado", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [overrideUserContent(b)], decisoes: [decisao(b)] }), async (v, ctx) => {
    const inv = await import(`${url("src/meta/i18n-inventory.js")}?t=${Date.now()}`)
    const p = inv.buildInventory({ repoRoot: ctx.root }).points
      .find((x) => x.line === ctx.alvo.line && x.column === ctx.alvo.column)
    assert.equal(p.audience, "user_content")
    assert.equal(p.classification, "out_of_scope", "conteúdo do usuário não entra na claim English-first")
  })
})

// ── NEGATIVOS: cada porta, uma por vez ─────────────────────────────────────

/**
 * A PORTA MAIS IMPORTANTE. A audiência é a decisão de CANAL e vem antes; sem
 * ela bastaria declarar "é do usuário" num diagnóstico público para a frase sair
 * da claim sem ninguém ter revisto a classificação.
 */
test("NEGATIVO: sem override de audiência, a decisão é recusada", async (t) => {
  await comProjeto(t, (b) => ({ decisoes: [decisao(b)] }),
    (v) => reprova(v, /exige audiência `user_content`/))
})

test("NEGATIVO: audiência de PRODUTO não autoriza a estratégia", async (t) => {
  await comProjeto(t, (b) => ({
    overrides: [overrideUserContent(b, "public_diagnostic")], decisoes: [decisao(b)],
  }), (v) => reprova(v, /exige audiência `user_content`/))
})

/**
 * O ATALHO FECHADO. `unresolvedProvenance` só cobra decisão de ponto `in_scope`,
 * e `user_content` está fora da claim — marcar a audiência já tiraria o ponto do
 * gate. Sem esta porta, a estratégia seria decoração opcional.
 */
test("NEGATIVO: audiência `user_content` SEM decisão não passa calado", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [overrideUserContent(b)] }),
    (v) => reprova(v, /NÃO declara `preserve_user_content_verbatim`/))
})

/**
 * `translationSite` diria "traduza na origem" — o CONTRÁRIO do que esta
 * estratégia significa. Aceitá-lo deixaria as duas indistinguíveis no JSON.
 */
test("NEGATIVO: declarar `translationSite` bloqueia — esta estratégia não traduz nada", async (t) => {
  await comProjeto(t, (b) => ({
    overrides: [overrideUserContent(b)],
    decisoes: [decisao(b, { translationSite: "value_origin" })],
  }), (v) => reprova(v, /`translationSite` NÃO pertence a esta estratégia/))
})

test("NEGATIVO: `sourceKind` de origem do PROJETO bloqueia", async (t) => {
  await comProjeto(t, (b) => {
    const d = decisao(b)
    d.values[b.alvo.provenance.ids[0]].sourceKind = "project_module_literal"
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /sourceKind` inválido/))
})

test("NEGATIVO: `boundary` ausente ou fora da lista fechada bloqueia", async (t) => {
  await comProjeto(t, (b) => {
    const d = decisao(b)
    delete d.values[b.alvo.provenance.ids[0]].boundary
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /boundary` inválida/))

  await comProjeto(t, (b) => {
    const d = decisao(b)
    d.values[b.alvo.provenance.ids[0]].boundary = "telepatia"
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /boundary` inválida/))
})

test("NEGATIVO: `category` não pertence a esta estratégia", async (t) => {
  await comProjeto(t, (b) => {
    const d = decisao(b)
    d.values[b.alvo.provenance.ids[0]].category = "identifier"
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /category` não pertence a esta estratégia/))
})

test("NEGATIVO: reason/owner/evidence vazios no VALOR bloqueiam", async (t) => {
  for (const campo of ["reason", "owner", "evidence"]) {
    await comProjeto(t, (b) => {
      const d = decisao(b)
      d.values[b.alvo.provenance.ids[0]][campo] = "   "
      return { overrides: [overrideUserContent(b)], decisoes: [d] }
    }, (v) => reprova(v, new RegExp(`${campo}\`? vazio`)))
  }
})

test("NEGATIVO: templateId sem valor, e valor sem templateId, bloqueiam", async (t) => {
  await comProjeto(t, (b) => {
    const d = decisao(b)
    delete d.values[b.alvo.provenance.ids[0]]
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /ausente/))

  await comProjeto(t, (b) => {
    const d = decisao(b)
    d.values.sobra = valorDoUsuario("sobra")
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /entrada sem templateId correspondente/))
})

test("NEGATIVO: interpolações divergentes do gerado bloqueiam", async (t) => {
  await comProjeto(t, (b) => {
    const d = decisao(b)
    d.interpolations = [b.alvo.provenance.ids[0]]
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /interpolações divergem do gerado|entrada sem templateId/))
})

test("NEGATIVO: hash divergente bloqueia — decisão envelhecida", async (t) => {
  await comProjeto(t, (b) => ({
    overrides: [overrideUserContent(b)],
    decisoes: [decisao(b, { expectedFileHash: `sha256:${"9".repeat(64)}` })],
  }), (v) => reprova(v, /`expectedFileHash` não confere|malformado/))
})

test("NEGATIVO: âncora inexistente bloqueia", async (t) => {
  await comProjeto(t, (b) => ({
    overrides: [overrideUserContent(b)],
    decisoes: [decisao(b, { line: 999 })],
  }), (v) => reprova(v, /nenhum callsite em/))
})

/**
 * ORIGEM É OPCIONAL, MAS NUNCA MEIA-BOCA. O texto nasce em runtime e quase nunca
 * tem âncora no repositório; quando alguém declarar uma, ela é validada com o
 * mesmo rigor das outras estratégias — hash incluso.
 */
test("NEGATIVO: `origin` declarada porém incompleta bloqueia", async (t) => {
  await comProjeto(t, (b) => {
    const d = decisao(b)
    d.values[b.alvo.provenance.ids[0]].origin = { file: "src/cli/index.js", line: 3 }
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /origin\.column` ausente/))
})

test("NEGATIVO: `origin` fora do repositório bloqueia", async (t) => {
  await comProjeto(t, (b) => {
    const d = decisao(b)
    d.values[b.alvo.provenance.ids[0]].origin = {
      file: "../fora.js", line: 1, column: 1, expectedFileHash: b.hash,
    }
    return { overrides: [overrideUserContent(b)], decisoes: [d] }
  }, (v) => reprova(v, /origin\.file`/))
})
