import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "installer", "opencode-jsonc.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

async function ocHome(json, jsonc) {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-ocj-"))
  const dir = path.join(home, ".config", "opencode")
  await mkdir(dir, { recursive: true })
  if (json != null) await writeFile(path.join(dir, "opencode.json"), json)
  if (jsonc != null) await writeFile(path.join(dir, "opencode.jsonc"), jsonc)
  return home
}

test("parseJsonc: tolera comentários e trailing commas; não quebra strings com //", async () => {
  const { parseJsonc } = await imp()
  const txt = `{
    // comentário de linha
    "provider": "anthropic", /* bloco */
    "url": "https://x/y", // url com // dentro de string preservada
    "plugin": ["a", "b",],
  }`
  const o = parseJsonc(txt)
  assert.equal(o.provider, "anthropic")
  assert.equal(o.url, "https://x/y")
  assert.deepEqual(o.plugin, ["a", "b"])
})

test("planOpenCodeFix: sem conflito → action none", async () => {
  const home = await ocHome("{}", null)
  try { const { planOpenCodeFix } = await imp(); assert.equal(planOpenCodeFix(home).action, "none") }
  finally { await rm(home, { recursive: true, force: true }) }
})

test("CONFIG IS SACRED: jsonc com OAuth/provider/model/plugin → action preserve (NUNCA consolida)", async () => {
  const home = await ocHome(
    JSON.stringify({ skills: { paths: ["/g"] }, instructions: ["gstack"] }),
    `{ "plugin": ["opencode-openai-codex-auth"], "provider": "anthropic", "model": "claude", /* oauth */ }`
  )
  try {
    const { planOpenCodeFix, applyOpenCodeFix } = await imp()
    const p = planOpenCodeFix(home)
    assert.equal(p.action, "preserve", "jsonc sensível é fonte de verdade")
    assert.deepEqual(p.sensitiveKeys.sort(), ["model", "plugin", "provider"])
    // mesmo com --apply, RECUSA e não toca no disco
    const r = applyOpenCodeFix(home, { apply: true })
    assert.equal(r.applied, false)
    assert.equal(r.refused, true)
    assert.ok(existsSync(p.jsoncPath), "jsonc permanece intacto e ativo")
    assert.ok(!existsSync(p.jsoncPath + ".gstack-disabled"), "nada foi renomeado")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("merge só quando jsonc é SEGURO (sem chaves sensíveis) E com --apply; dry-run é default", async () => {
  const home = await ocHome(
    JSON.stringify({ instructions: ["gstack"] }),
    `{ "theme": "dark" }` // sem provider/plugin/model → seguro
  )
  try {
    const { planOpenCodeFix, applyOpenCodeFix } = await imp()
    const p = planOpenCodeFix(home)
    assert.equal(p.action, "merge")
    // sem apply → NÃO altera o disco (dry-run default)
    const dry = applyOpenCodeFix(home)
    assert.equal(dry.applied, false)
    assert.equal(dry.wouldMerge, true)
    assert.ok(existsSync(p.jsoncPath), "dry-run: jsonc intacto")
    // com apply → consolida (reversível)
    const r = applyOpenCodeFix(home, { apply: true })
    assert.equal(r.applied, true)
    const merged = JSON.parse(await readFile(r.jsonPath, "utf-8"))
    assert.equal(merged.theme, "dark")
    assert.ok(Array.isArray(merged.instructions))
    assert.ok(existsSync(r.jsoncPath + ".gstack_vibehard.bak"), "jsonc no backup")
    assert.ok(!existsSync(r.jsoncPath), "jsonc saiu do caminho ativo")
    assert.ok(existsSync(r.disabledPath), "jsonc preservado como .gstack-disabled")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("restoreOpenCodeJsonc: reverte .jsonc.gstack-disabled sem apagar config do usuário", async () => {
  const home = await ocHome(JSON.stringify({ instructions: ["gstack"] }), null)
  try {
    const dir = path.join(home, ".config", "opencode")
    await writeFile(path.join(dir, "opencode.jsonc.gstack-disabled"), `{ "provider": "anthropic" }`)
    const { restoreOpenCodeJsonc } = await imp()
    const r = restoreOpenCodeJsonc(home)
    assert.equal(r.restored, true)
    assert.ok(existsSync(path.join(dir, "opencode.jsonc")), "jsonc ativo de volta")
    assert.ok(!existsSync(path.join(dir, "opencode.jsonc.gstack-disabled")), "resíduo consumido")
    // idempotente: sem resíduo → não faz nada, sem crash
    assert.equal(restoreOpenCodeJsonc(home).restored, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("diagnoseOpenCode: read-only, reporta chaves sensíveis por NOME e risco de shadowing", async () => {
  const home = await ocHome(JSON.stringify({ x: 1 }), `{ "provider": "anthropic", "oauth": { "t": "SECRET" } }`)
  try {
    const { diagnoseOpenCode } = await imp()
    const d = diagnoseOpenCode(home)
    assert.equal(d.conflict, true)
    assert.deepEqual(d.jsoncSensitiveKeys.sort(), ["oauth", "provider"])
    assert.equal(d.shadowingRisk, "high")
    assert.equal(d.recommendedAction, "preserve")
    // nunca vaza valor de segredo
    assert.ok(!JSON.stringify(d).includes("SECRET"), "diagnóstico não contém valores sensíveis")
    assert.ok(existsSync(d.jsoncPath), "read-only: nada alterado")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("CLEAN MACHINE E2E: jsonc com codex-auth+providers+models fica BYTE-FOR-BYTE após fix", async () => {
  const { createHash } = await import("node:crypto")
  const jsoncText = `{
  // OpenCode Desktop config (OAuth ativo)
  "plugin": ["opencode-openai-codex-auth"],
  "provider": { "openai": { "model": "gpt-5" }, "anthropic": {} },
  "model": "anthropic/claude",
  "models": ["gpt-5", "claude"],
}`
  const home = await ocHome(JSON.stringify({ instructions: ["gstack"] }), jsoncText)
  try {
    const dir = path.join(home, ".config", "opencode")
    const jsoncPath = path.join(dir, "opencode.jsonc")
    const before = createHash("sha256").update(await readFile(jsoncPath)).digest("hex")
    const { applyOpenCodeFix, planOpenCodeFix } = await imp()
    assert.equal(planOpenCodeFix(home).action, "preserve")
    // dry-run (default) e até --apply: recusa e não altera o .jsonc
    applyOpenCodeFix(home)
    applyOpenCodeFix(home, { apply: true })
    const after = createHash("sha256").update(await readFile(jsoncPath)).digest("hex")
    assert.equal(after, before, "opencode.jsonc permanece byte-for-byte")
    assert.ok(!existsSync(jsoncPath + ".gstack-disabled"))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("planOpenCodeFix: jsonc malformado de verdade → action manual (não tenta merge)", async () => {
  const home = await ocHome("{}", `{ "x": [1 2 3] }`) // sem vírgulas, inválido mesmo p/ JSONC
  try { const { planOpenCodeFix } = await imp(); const p = planOpenCodeFix(home); assert.equal(p.action, "manual"); assert.ok(p.parseError) }
  finally { await rm(home, { recursive: true, force: true }) }
})
