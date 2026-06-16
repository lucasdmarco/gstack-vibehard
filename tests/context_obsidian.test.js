import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const obsMod = path.join(repoRoot, "src", "context-docs", "obsidian.js")
const gphMod = path.join(repoRoot, "src", "context-docs", "graphify.js")

test("obsidian: set grava path no context.json; get lê (opt-in)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-obs-"))
  try {
    const { setObsidianPath, getObsidianPath } = await import(`${pathToFileURL(obsMod)}?t=${Date.now()}`)
    assert.equal(getObsidianPath(tmp), null, "sem config → null (não age)")
    setObsidianPath(tmp, "/home/u/vault")
    assert.equal(getObsidianPath(tmp), "/home/u/vault")
    const reg = JSON.parse(await readFile(path.join(tmp, ".gstack", "context.json"), "utf-8"))
    assert.equal(reg.obsidian.path, "/home/u/vault")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("graphify: findGraphifyOutput detecta graph.json (ou null)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-gph-"))
  try {
    const { findGraphifyOutput } = await import(`${pathToFileURL(gphMod)}?t=${Date.now()}`)
    assert.equal(findGraphifyOutput(tmp), null, "sem graphify-out → null")
    const { mkdir, writeFile } = await import("node:fs/promises")
    await mkdir(path.join(tmp, "graphify-out"), { recursive: true })
    await writeFile(path.join(tmp, "graphify-out", "graph.json"), "{}")
    assert.ok(findGraphifyOutput(tmp).endsWith("graph.json"))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
