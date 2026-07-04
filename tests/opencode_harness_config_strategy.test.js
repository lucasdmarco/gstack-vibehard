import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const ocMod = path.join(repoRoot, "src", "harness", "opencode.js")
const checkMod = path.join(repoRoot, "src", "installer", "check.js")

function freshReport() { return { added: [], updated: [], skipped: [], errors: [] } }

async function makeHome(files = {}) {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-ocs-"))
  const dir = path.join(home, ".config", "opencode")
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content)
  return home
}

test("installOpenCode: só .jsonc → NÃO cria opencode.json; plugins copiados", async () => {
  const home = await makeHome({ "opencode.jsonc": '{ "plugin": ["opencode-openai-codex-auth"] }' })
  try {
    const { installOpenCode } = await import(`${pathToFileURL(ocMod)}?t=${Date.now()}`)
    const report = freshReport()
    await installOpenCode({ hooks: true }, report, { home })
    const jsonPath = path.join(home, ".config", "opencode", "opencode.json")
    assert.equal(existsSync(jsonPath), false, "não cria opencode.json concorrente")
    // jsonc preservado intacto
    const jsonc = await readFile(path.join(home, ".config", "opencode", "opencode.jsonc"), "utf-8")
    assert.ok(jsonc.includes("opencode-openai-codex-auth"), "plugin OAuth preservado")
    // plugins gstack instalados (auto-load)
    assert.ok(existsSync(path.join(home, ".config", "opencode", "plugins", "gstack-security.js")))
    assert.ok(report.skipped.some((s) => /directory_only/.test(s)))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("installOpenCode: .jsonc REAL com provider/model/plugin/OAuth → jsonc byte-for-byte, sem opencode.json (PRD24 24.1)", async () => {
  const { createHash } = await import("node:crypto")
  const jsoncText = `{
  // OpenCode Desktop config (OAuth ativo)
  "plugin": ["opencode-openai-codex-auth"],
  "provider": { "openai": { "model": "gpt-5" }, "anthropic": {} },
  "model": "anthropic/claude",
  "models": ["gpt-5", "claude"],
}`
  const home = await makeHome({ "opencode.jsonc": jsoncText })
  const jsoncPath = path.join(home, ".config", "opencode", "opencode.jsonc")
  try {
    const before = createHash("sha256").update(await readFile(jsoncPath)).digest("hex")
    const { installOpenCode } = await import(`${pathToFileURL(ocMod)}?t=${Date.now()}`)
    await installOpenCode({ hooks: true }, freshReport(), { home })
    assert.equal(existsSync(path.join(home, ".config", "opencode", "opencode.json")), false, "nunca cria opencode.json com jsonc presente")
    const after = createHash("sha256").update(await readFile(jsoncPath)).digest("hex")
    assert.equal(after, before, "opencode.jsonc (provider/model/plugin/OAuth) preservado byte-for-byte")
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("installOpenCode: só .json → merge não-destrutivo preservando chaves do usuário", async () => {
  const home = await makeHome({ "opencode.json": JSON.stringify({ provider: "anthropic", plugin: ["x"] }) })
  try {
    const { installOpenCode } = await import(`${pathToFileURL(ocMod)}?t=${Date.now()}`)
    const report = freshReport()
    await installOpenCode({ hooks: true }, report, { home })
    const merged = JSON.parse(await readFile(path.join(home, ".config", "opencode", "opencode.json"), "utf-8"))
    assert.equal(merged.provider, "anthropic", "chave do usuário preservada")
    assert.ok(Array.isArray(merged.instructions), "gstack adicionou instructions")
    assert.ok(report.updated.some((u) => /opencode\.json/.test(u)))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("installOpenCode: ambos → não escreve config (conflito), plugins ainda copiados", async () => {
  const home = await makeHome({ "opencode.json": "{}", "opencode.jsonc": "{}" })
  try {
    const { installOpenCode } = await import(`${pathToFileURL(ocMod)}?t=${Date.now()}`)
    const report = freshReport()
    await installOpenCode({ hooks: true }, report, { home })
    // opencode.json permanece "{}" (não sobrescrito)
    const json = await readFile(path.join(home, ".config", "opencode", "opencode.json"), "utf-8")
    assert.equal(json.trim(), "{}", "config não sobrescrita em conflito")
    assert.ok(existsSync(path.join(home, ".config", "opencode", "plugins", "gstack-session.js")))
    assert.ok(report.skipped.some((s) => /conflito|conflict/i.test(s)))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("checkAlreadyInstalled: detecta opencode via plugins (sem opencode.json)", async () => {
  const home = await makeHome({ "opencode.jsonc": "{}" })
  const prevHome = process.env.HOME, prevUP = process.env.USERPROFILE
  try {
    await mkdir(path.join(home, ".config", "opencode", "plugins"), { recursive: true })
    await writeFile(path.join(home, ".config", "opencode", "plugins", "gstack-security.js"), "// gstack")
    process.env.HOME = home; process.env.USERPROFILE = home
    const { checkAlreadyInstalled } = await import(`${pathToFileURL(checkMod)}?t=${Date.now()}`)
    assert.ok(checkAlreadyInstalled(["opencode"]).includes("opencode"), "detecta via plugin, sem exigir opencode.json")
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevUP === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUP
    await rm(home, { recursive: true, force: true })
  }
})
