import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "harness", "opencode-doctor.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

// Home OpenCode isolada (nunca ~ real). files = { json?, jsonc?, disabled?, plugins?[] }
async function ocHome(files = {}) {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-ocd-"))
  const dir = path.join(home, ".config", "opencode")
  await mkdir(dir, { recursive: true })
  if (files.json != null) await writeFile(path.join(dir, "opencode.json"), files.json)
  if (files.jsonc != null) await writeFile(path.join(dir, "opencode.jsonc"), files.jsonc)
  if (files.disabled != null) await writeFile(path.join(dir, "opencode.jsonc.gstack-disabled"), files.disabled)
  if (files.plugins) {
    const pdir = path.join(dir, "plugins")
    await mkdir(pdir, { recursive: true })
    for (const p of files.plugins) await writeFile(path.join(pdir, p), "// plugin\n")
  }
  return { home, dir }
}
const present = () => "0.28.0"    // CLI OpenCode presente
const absent = () => null         // CLI ausente
const hash = async (p) => createHash("sha256").update(await readFile(p)).digest("hex")

const SENSITIVE_JSONC = `{
  // OpenCode Desktop (OAuth ativo)
  "plugin": ["opencode-openai-codex-auth"],
  "provider": "anthropic",
  "model": "claude",
}`

test("conflito json+jsonc sensível (--strict, CLI presente): authority jsonc, shadowing high, exit 2, byte-for-byte", async () => {
  const { buildOpenCodeDoctorV2 } = await imp()
  const { home, dir } = await ocHome({ json: '{"model":"x"}', jsonc: SENSITIVE_JSONC })
  const jsoncPath = path.join(dir, "opencode.jsonc")
  try {
    const before = await hash(jsoncPath)
    const r = buildOpenCodeDoctorV2({ home, probe: present, strict: true })
    assert.equal(r.schemaVersion, "gstack.opencode.v2")
    assert.equal(r.categories.config.authority, "jsonc", "jsonc sensível é a autoridade mesmo com json ao lado")
    assert.equal(r.categories.config.shadowingRisk, "high")
    assert.equal(r.categories.system.status, "ok", "CLI presente")
    assert.equal(r.exitCode, 2, "warning-only (config warn), exit 2")
    assert.equal(r.ok, false)
    assert.equal(await hash(jsoncPath), before, "read-only: jsonc byte-for-byte")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("jsonc malformado + json: config error → exitCode 1, sem escrita", async () => {
  const { buildOpenCodeDoctorV2 } = await imp()
  const { home, dir } = await ocHome({ json: "{}", jsonc: `{ "x": [1 2 3] }` })
  const jsoncPath = path.join(dir, "opencode.jsonc")
  try {
    const before = await hash(jsoncPath)
    const r = buildOpenCodeDoctorV2({ home, probe: present })
    assert.equal(r.categories.config.status, "error")
    assert.ok(r.categories.config.parseError)
    assert.equal(r.exitCode, 1)
    assert.equal(await hash(jsoncPath), before, "read-only")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("resíduo .jsonc.gstack-disabled: residue warn + recommendedAction restore-jsonc", async () => {
  const { buildOpenCodeDoctorV2 } = await imp()
  const { home } = await ocHome({ json: '{"instructions":["g"]}', disabled: `{ "provider": "anthropic" }` })
  try {
    const r = buildOpenCodeDoctorV2({ home, probe: present })
    assert.equal(r.categories.residue.status, "warn")
    assert.ok(r.categories.residue.disabledJsonc)
    assert.ok(r.recommendedActions.find((a) => a.id === "restore-jsonc" && a.requiresFlag === "--restore-jsonc"))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("plugins gerenciados presentes: managedPresent com os 3 + enforcement plugin_backed", async () => {
  const { buildOpenCodeDoctorV2, MANAGED_PLUGINS } = await imp()
  const { home } = await ocHome({ jsonc: SENSITIVE_JSONC, plugins: [...MANAGED_PLUGINS] })
  try {
    const r = buildOpenCodeDoctorV2({ home, probe: present })
    assert.deepEqual(r.categories.plugins.managedPresent.sort(), [...MANAGED_PLUGINS].sort())
    assert.equal(r.categories.plugins.status, "ok")
    assert.equal(r.enforcement, "plugin_backed")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("CLI OpenCode ausente: warn no modo normal, error em --strict", async () => {
  const { buildOpenCodeDoctorV2 } = await imp()
  const { home } = await ocHome({ jsonc: '{ "theme": "dark" }' })
  try {
    assert.equal(buildOpenCodeDoctorV2({ home, probe: absent }).categories.system.status, "warn")
    const strict = buildOpenCodeDoctorV2({ home, probe: absent, strict: true })
    assert.equal(strict.categories.system.status, "error")
    assert.equal(strict.exitCode, 1)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("só jsonc sensível (sem json): authority jsonc, sem conflito, sem plugins → rules_only", async () => {
  const { buildOpenCodeDoctorV2 } = await imp()
  const { home } = await ocHome({ jsonc: SENSITIVE_JSONC })
  try {
    const r = buildOpenCodeDoctorV2({ home, probe: present })
    assert.equal(r.categories.config.authority, "jsonc")
    assert.equal(r.categories.config.hasJson, false)
    assert.equal(r.enforcement, "rules_only")
    assert.equal(r.categories.models.status, "unknown")
  } finally { await rm(home, { recursive: true, force: true }) }
})
