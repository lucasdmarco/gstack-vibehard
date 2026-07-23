import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const GEN = path.join(repoRoot, "agents", "generated")

/**
 * PRD50 S50.5 — contrato epistêmico cross-harness (§8).
 *
 * Exigência do PRD: **uma fonte canônica**, compilada para os adapters. Nunca
 * texto duplicado à mão em 20 agentes. A fonte é `core/03-verificacao-epistemica.md`,
 * que o compilador (`scripts/scripts/build_agents.js`) já injeta em TODO adapter
 * via `coreText`.
 */

const CANONICAL = path.join(repoRoot, "core", "03-verificacao-epistemica.md")

test("§8: existe UMA fonte canônica do contrato epistêmico em core/", async () => {
  assert.ok(existsSync(CANONICAL), "core/03-verificacao-epistemica.md é a fonte única")
  const text = readFileSync(CANONICAL, "utf-8")
  // As 5 obrigações do contrato curto (§8), verificadas por conteúdo real.
  assert.match(text, /proporcional ao risco/i)
  assert.match(text, /contradi/i)
  // \s+ entre as palavras: o markdown quebra linha no meio da frase.
  assert.match(text, /fatos\s+verificados, inferências e hipóteses/i)
  assert.match(text, /não afirme ter consultado fonte,\s+executado\s+teste ou usado ferramenta/i)
  assert.match(text, /inconclusiv/i)
  assert.match(text, /advisory/i)
})

test("§8: o contrato é CURTO — não vira paredão de prompt", async () => {
  const text = readFileSync(CANONICAL, "utf-8")
  assert.ok(text.length < 2600, `contrato deve ser curto, tem ${text.length} chars`)
})

test("CONTROLE NEGATIVO: o contrato NÃO pede chain-of-thought (§7 / §17.2)", async () => {
  const text = readFileSync(CANONICAL, "utf-8")
  assert.ok(!/pense passo a passo|chain.of.thought|mostre seu raciocínio/i.test(text),
    "persistir/expor raciocínio interno é proibido pelo PRD")
})

test("CONTROLE NEGATIVO: o contrato NÃO promete Gemini/Deep Think/Aletheia (§17.2)", async () => {
  const text = readFileSync(CANONICAL, "utf-8")
  assert.ok(!/gemini|deep think|aletheia/i.test(text))
})

// --- compilação real para os adapters ---
const claudeAdapters = () => {
  const dir = path.join(GEN, "claude")
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(path.join(dir, d, "SKILL.md"))) : []
}

test("COMPILAÇÃO REAL: todo adapter Claude gerado contém o contrato (via coreText)", async () => {
  const ids = claudeAdapters()
  assert.ok(ids.length >= 20, `esperado >= 20 agentes, achei ${ids.length}`)
  for (const id of ids) {
    const md = readFileSync(path.join(GEN, "claude", id, "SKILL.md"), "utf-8")
    assert.match(md, /não afirme ter consultado fonte,\s+executado\s+teste ou usado ferramenta/i, `${id} sem o contrato`)
  }
})

test("COMPILAÇÃO REAL: Codex (.toml) e Cursor (.mdc) também recebem o contrato", async () => {
  for (const [dir, ext] of [[["codex"], ".toml"], [["cursor", "rules"], ".mdc"]]) {
    const d = path.join(GEN, ...dir)
    const files = existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(ext)) : []
    assert.ok(files.length > 0, `há adapters ${ext}`)
    const sample = readFileSync(path.join(d, files[0]), "utf-8")
    assert.match(sample, /não afirme ter consultado fonte/i, `adapter ${ext} sem o contrato`)
  }
})

test("§8: o contrato NÃO foi duplicado à mão nos agentes-fonte", async () => {
  const srcDir = path.join(repoRoot, "agents", "agents")
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith(".md"))) {
    const body = readFileSync(path.join(srcDir, f), "utf-8")
    assert.ok(!/não afirme ter consultado fonte/i.test(body),
      `${f} duplicou o contrato — ele deve vir só de core/ (§8)`)
  }
})

// --- paridade honesta de enforcement (§5.4 / DoD do sprint) ---
test("DoD: paridade de contrato SEM afirmar enforcement em harness instrucional", async () => {
  const { epistemicContractProjection } = await imp("src/epistemic/harness-projection.js")
  const claude = epistemicContractProjection("claude")
  assert.equal(claude.contractDelivered, true)
  assert.equal(claude.enforcement, "enforced", "Claude tem real_hooks")

  for (const h of ["codex", "copilot", "gemini"]) {
    const p = epistemicContractProjection(h)
    assert.equal(p.contractDelivered, true, `${h} recebe o mesmo contrato`)
    assert.notEqual(p.enforcement, "enforced", `${h} NUNCA é declarado enforced`)
  }
})

test("CONTROLE NEGATIVO: harness desconhecido -> advisory, nunca enforced por omissão", async () => {
  const { epistemicContractProjection } = await imp("src/epistemic/harness-projection.js")
  const p = epistemicContractProjection("harness-que-nao-existe")
  assert.equal(p.enforcement, "advisory")
  assert.equal(p.contractDelivered, false, "harness desconhecido não recebe projeção")
})

test("os 3 harnesses do DoD produzem o MESMO schema e os MESMOS níveis", async () => {
  const { epistemicContractProjection } = await imp("src/epistemic/harness-projection.js")
  const projections = ["claude", "codex", "opencode"].map(epistemicContractProjection)
  const [first] = projections
  for (const p of projections) {
    assert.equal(p.schemaVersion, first.schemaVersion)
    assert.deepEqual(p.levels, first.levels, "EV0/EV1/EV2 idênticos em todo harness")
    assert.equal(p.reviewSchema, "gstack.epistemic-review.v1")
  }
})

test("DoD: nenhuma projeção omite `notPerformed` do contrato de saída", async () => {
  const { epistemicContractProjection } = await imp("src/epistemic/harness-projection.js")
  for (const h of ["claude", "codex", "opencode"]) {
    assert.ok(epistemicContractProjection(h).requiredOutputFields.includes("notPerformed"), h)
  }
})
