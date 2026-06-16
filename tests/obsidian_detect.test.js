import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const obsMod = path.join(repoRoot, "src", "context-docs", "obsidian.js")

test("detectObsidianVaults: parseia obsidian.json (fixture); ausência → []", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-obsdet-"))
  try {
    const { detectObsidianVaults } = await import(`${pathToFileURL(obsMod)}?t=${Date.now()}`)
    // dir sem config → []
    assert.deepEqual(detectObsidianVaults(tmp), [])
    // com config → lista os vaults
    const cfg = path.join(tmp, "cfg")
    await mkdir(cfg, { recursive: true })
    await writeFile(path.join(cfg, "obsidian.json"),
      JSON.stringify({ vaults: { abc: { path: "/home/u/MeuVault", open: true }, def: { path: "/v2", open: false } } }))
    const vaults = detectObsidianVaults(cfg)
    assert.equal(vaults.length, 2)
    assert.ok(vaults.some((v) => v.path === "/home/u/MeuVault" && v.open === true))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("chooseObsidian: escolha de vault, 'outra pasta', e 'pular' (UI injetada)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-obschoose-"))
  try {
    const { chooseObsidian } = await import(`${pathToFileURL(obsMod)}?t=${Date.now()}`)
    const cfg = path.join(tmp, "cfg")
    await mkdir(cfg, { recursive: true })
    await writeFile(path.join(cfg, "obsidian.json"), JSON.stringify({ vaults: { a: { path: "/vault/A" } } }))

    // escolhe o vault detectado
    let chosen = await chooseObsidian({ select: async (_q, opts) => opts.find((o) => o.includes("/vault/A")), prompt: async () => "" }, cfg)
    assert.equal(chosen, "/vault/A")

    // 'pular' → null (nada configurado/indexado)
    chosen = await chooseObsidian({ select: async (_q, opts) => opts.find((o) => o.includes("Pular")), prompt: async () => "" }, cfg)
    assert.equal(chosen, null)

    // 'outra pasta' → digita caminho
    chosen = await chooseObsidian({ select: async (_q, opts) => opts.find((o) => o.includes("Outra")), prompt: async () => "/digitada" }, cfg)
    assert.equal(chosen, "/digitada")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("getObsidianPath: prioridade projeto > default global", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-obsprio-"))
  const prevHome = process.env.HOME, prevUP = process.env.USERPROFILE
  try {
    // HOME isolado p/ o default global
    process.env.HOME = tmp; process.env.USERPROFILE = tmp
    const mod = await import(`${pathToFileURL(obsMod)}?t=${Date.now()}`)
    const proj = path.join(tmp, "proj")
    await mkdir(proj, { recursive: true })

    // só global
    mod.setGlobalObsidianDefault("/global/vault")
    assert.equal(mod.getObsidianPath(proj), "/global/vault")
    // projeto sobrepõe o global
    mod.setObsidianPath(proj, "/projeto/vault")
    assert.equal(mod.getObsidianPath(proj), "/projeto/vault")
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevUP === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUP
    await rm(tmp, { recursive: true, force: true })
  }
})
