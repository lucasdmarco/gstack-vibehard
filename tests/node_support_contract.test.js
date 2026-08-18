import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

/**
 * CONTRATO DE SUPORTE A NODE — a decisão e o produto dizendo a MESMA coisa.
 *
 * A decisão de 2026-08-17 é `safe_support: node22_official_only`, com Node 18/20
 * em `best_effort`. Uma decisão registrada que o produto contradiz é pior que
 * decisão nenhuma, porque parece resolvida — e foi exatamente esse o estado
 * durante todo o `P0.NODE-SUPPORT-GATE-INVALID`: `engines` anunciava `>=18` sem
 * que ninguém tivesse decidido suportar 18.
 *
 * O QUE ESTE ARQUIVO GUARDA é a coerência entre quatro lugares que podem
 * divergir em silêncio: o ledger, `package.json#engines`, o bootstrap
 * (`node-health.js`) e o CI.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel) => readFileSync(path.join(repoRoot, rel), "utf-8")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const health = async (versao) => {
  const { checkNodeHealth } = await imp("src/installer/node-health.js")
  return checkNodeHealth({
    exec: (_f, a) => (a.includes("--version") ? versao : "gstack-smoke"),
    platform: "linux",
    mkdtemp: () => "/tmp/gstack-fake",
    write: () => {},
    cleanup: () => {},
  })
}

// ── Os três níveis ─────────────────────────────────────────────────────────

test("Node >=22 é OFICIAL: sem aviso e sem blocker", async () => {
  for (const v of ["v22.21.1", "v24.14.0"]) {
    const h = await health(v)
    assert.equal(h.node.supportTier, "official", v)
    assert.deepEqual(h.warnings, [], `${v} não pode gerar ressalva`)
    assert.equal(h.ok, true)
  }
})

/**
 * O CASO QUE A DECISÃO EXISTE PARA DESCREVER: 18/20 RODAM. A matriz de
 * 2026-08-05 mediu pacote real em Windows e as quatro versões deram
 * `runtime_compatible` — a hipótese de incompatibilidade foi REFUTADA.
 *
 * Por isso o bootstrap AVISA e não bloqueia. Bloquear afirmaria uma
 * incompatibilidade que a medição desmentiu, e quebraria quem já usa.
 */
test("Node 18/20 é BEST_EFFORT: avisa, e NÃO bloqueia", async () => {
  for (const v of ["v18.20.8", "v20.19.5"]) {
    const h = await health(v)
    assert.equal(h.node.supportTier, "best_effort", v)
    assert.equal(h.ok, true, `${v} roda — bloquear afirmaria incompatibilidade que a matriz refutou`)
    assert.equal(h.blockers.length, 0)
    assert.equal(h.warnings.length, 1, "a ressalva precisa APARECER")
    assert.match(h.warnings[0], /best_effort/)
  }
})

/**
 * Abaixo de 18 não é "não suportado" — é NÃO MEDIDO. A matriz começa no 18, e
 * afirmar qualquer coisa abaixo disso seria inventar evidência.
 */
test("abaixo de v18 BLOQUEIA, e o motivo é ausência de medição", async () => {
  const h = await health("v16.20.0")
  assert.equal(h.node.supportTier, "unmeasured")
  assert.equal(h.ok, false)
  assert.equal(h.blockers.length, 1)
  assert.match(h.blockers[0], /piso MEDIDO|não há evidência/)
})

test("aviso e blocker são listas SEPARADAS — somá-las confundiria os dois estados", async () => {
  const best = await health("v18.20.8")
  assert.ok(Array.isArray(best.warnings) && Array.isArray(best.blockers))
  assert.equal(best.warnings.length > 0 && best.blockers.length === 0, true,
    "`roda com ressalva` e `não roda` precisam ser distinguíveis pelo consumidor")
})

// ── A coerência entre os quatro lugares ────────────────────────────────────

test("`engines` diz o mesmo que a decisão — e sem `engine-strict`", async () => {
  const pkg = JSON.parse(ler("package.json"))
  assert.equal(pkg.engines.node, ">=22", "o contrato público é o suporte OFICIAL")

  const { checkNodeHealth } = await imp("src/installer/node-health.js")
  const h = checkNodeHealth({
    exec: (_f, a) => (a.includes("--version") ? "v22.0.0" : "gstack-smoke"),
    platform: "linux", mkdtemp: () => "/tmp/x", write: () => {}, cleanup: () => {},
  })
  assert.equal(h.node.officialMajor, 22, "bootstrap e `engines` precisam concordar")
  assert.equal(`>=${h.node.officialMajor}`, pkg.engines.node)

  // Sem `engine-strict`, o npm AVISA e não impede — que é a semântica de
  // best_effort. Com ele, 18/20 deixariam de instalar e a ressalva viraria veto.
  assert.equal(ler("package.json").includes("engine-strict"), false)
})

test("o ledger registra a decisão, e o produto a cumpre", async () => {
  const { PRD51_RC_ITEMS } = await imp("src/dream/rc-checklist-prd51.js")
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")
  const pkg = JSON.parse(ler("package.json"))

  assert.equal(item.supportDecision.safe_support, "node22_official_only")
  const oficial = item.supportDecision.tiers.find((t) => t.tier === "official")
  assert.equal(oficial.range, pkg.engines.node, "a faixa oficial do ledger É o `engines`")

  assert.equal(item.status, "delivered", "as duas condições foram cumpridas")
  assert.equal(item.supportDecision.remainingCondition, null)
  assert.ok(item.supportDecision.coherenceApplied.engines.includes(">=22"))
})

/**
 * O CI não pode exigir suíte verde de versão declarada `best_effort` — era o job
 * vermelho por construção que ORIGINOU este P0. Mas 18/20 também não podem sumir
 * do CI: `best_effort` afirma que o produto RODA, e alguma coisa precisa provar
 * isso. O `doctor` executa o produto; a suíte, não.
 */
test("o CI cobre 18/20 onde a claim é verdadeira, e não onde é falsa", () => {
  const ci = ler(".github/workflows/test.yml")

  assert.equal(/test-node-matrix:/.test(ci), false,
    "o job que rodava a suíte em 18/20 saiu — ele reprovava por construção")
  assert.match(ci, /doctor:[\s\S]*?node: \[18, 20, 22\]/,
    "`doctor` EXECUTA o produto em 18/20 — é a prova de que best_effort roda")
  assert.match(ci, /node-version: 22[\s\S]*?npm test/,
    "a suíte roda no mínimo OFICIAL")
})

test("o job de Node 24 é informativo, não requisito", () => {
  const ci = ler(".github/workflows/test.yml")
  assert.match(ci, /test-node-next:[\s\S]*?continue-on-error: true/,
    "compatibilidade futura não pode bloquear o RC")
})

// ── O que NÃO é afirmado ───────────────────────────────────────────────────

/**
 * A decisão de suporte não conserta a suíte e não prova cross-OS. Deixar
 * qualquer uma das duas escorregar junto seria transformar uma decisão de
 * política em evidência que ninguém produziu.
 */
test("decidir suporte NÃO afirma suíte verde nem cross-OS", async () => {
  const { PRD51_RC_ITEMS } = await imp("src/dream/rc-checklist-prd51.js")
  const item = PRD51_RC_ITEMS.find((i) => i.id === "P0.NODE-SUPPORT-GATE-INVALID")

  assert.equal(item.claims.suite_compatibility, "failing")
  assert.equal(item.claims.cross_os, "unproven")
  assert.match(item.runtimeMatrix.os_coverage, /windows_local/)
  assert.match(item.supportDecision.coherenceApplied.notClaimed, /cross-OS/)

  const best = item.supportDecision.tiers.find((t) => t.tier === "best_effort")
  assert.equal(best.claim, "runtime_compatible_windows_local",
    "o escopo viaja na claim: um SO medido nunca vira afirmação cross-OS")
})
