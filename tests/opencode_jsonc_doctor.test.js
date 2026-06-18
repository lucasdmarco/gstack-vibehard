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

test("planOpenCodeFix: conflito → merge preserva OAuth/plugin do jsonc (usuário)", async () => {
  const home = await ocHome(
    JSON.stringify({ skills: { paths: ["/g"] }, instructions: ["gstack"] }),
    `{ "plugin": ["opencode-openai-codex-auth"], "provider": "anthropic", /* oauth */ }`
  )
  try {
    const { planOpenCodeFix } = await imp()
    const p = planOpenCodeFix(home)
    assert.equal(p.action, "merge")
    assert.deepEqual(p.merged.plugin, ["opencode-openai-codex-auth"], "plugin OAuth preservado")
    assert.equal(p.merged.provider, "anthropic")
    assert.ok(Array.isArray(p.merged.instructions), "chave do gstack também presente")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("applyOpenCodeFix: consolida em opencode.json, backup dos dois, PRESERVA jsonc (renomeado)", async () => {
  const home = await ocHome(
    JSON.stringify({ instructions: ["gstack"] }),
    `{ "plugin": ["oauth-x"] }`
  )
  try {
    const { applyOpenCodeFix } = await imp()
    const r = applyOpenCodeFix(home)
    assert.equal(r.applied, true)
    const merged = JSON.parse(await readFile(r.jsonPath, "utf-8"))
    assert.deepEqual(merged.plugin, ["oauth-x"])
    assert.ok(Array.isArray(merged.instructions))
    // backups
    assert.ok(existsSync(r.jsonPath + ".gstack_vibehard.bak"), "json original no backup")
    assert.ok(existsSync(r.jsoncPath + ".gstack_vibehard.bak"), "jsonc no backup")
    // jsonc NÃO é apagado — é preservado como .gstack-disabled (reversível)
    assert.ok(!existsSync(r.jsoncPath), "jsonc original saiu do caminho ativo")
    assert.ok(existsSync(r.disabledPath), "jsonc preservado como .gstack-disabled")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("planOpenCodeFix: jsonc malformado de verdade → action manual (não tenta merge)", async () => {
  const home = await ocHome("{}", `{ "x": [1 2 3] }`) // sem vírgulas, inválido mesmo p/ JSONC
  try { const { planOpenCodeFix } = await imp(); const p = planOpenCodeFix(home); assert.equal(p.action, "manual"); assert.ok(p.parseError) }
  finally { await rm(home, { recursive: true, force: true }) }
})
