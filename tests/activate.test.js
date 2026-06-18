import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "commands", "activate.js")

async function load() {
  return import(`${pathToFileURL(mod)}?t=${Date.now()}`)
}

test("enable cria .gstack/ e status reflete ATIVO", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-act-"))
  try {
    const { activateCommand } = await load()
    const r = await activateCommand("enable", [], { cwd: tmp })
    assert.equal(r.status, "activated")
    assert.ok(existsSync(path.join(tmp, ".gstack")), "criou .gstack/")
    assert.ok(existsSync(path.join(tmp, ".gstack", "context.json")), "criou context.json")
    const s = await activateCommand("status", [], { cwd: tmp })
    assert.equal(s.status, "active")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("disable renomeia para .gstack-disabled/ e status fica DESATIVADO", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-act-"))
  try {
    const { activateCommand } = await load()
    await activateCommand("enable", [], { cwd: tmp })
    const r = await activateCommand("disable", [], { cwd: tmp })
    assert.equal(r.status, "disabled")
    assert.ok(!existsSync(path.join(tmp, ".gstack")), "removeu .gstack/")
    assert.ok(existsSync(path.join(tmp, ".gstack-disabled")), "preservou em .gstack-disabled/")
    const s = await activateCommand("status", [], { cwd: tmp })
    assert.equal(s.status, "disabled")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("enable reativa preservando dados (.gstack-disabled -> .gstack)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-act-"))
  try {
    const { activateCommand } = await load()
    await activateCommand("enable", [], { cwd: tmp })
    // marca um arquivo de dado dentro do .gstack para provar a preservação
    await writeFile(path.join(tmp, ".gstack", "plans.md"), "meu plano")
    await activateCommand("disable", [], { cwd: tmp })
    const r = await activateCommand("enable", [], { cwd: tmp })
    assert.equal(r.status, "reactivated")
    assert.ok(existsSync(path.join(tmp, ".gstack")), "reativou .gstack/")
    assert.ok(!existsSync(path.join(tmp, ".gstack-disabled")), "removeu .gstack-disabled/")
    const data = await readFile(path.join(tmp, ".gstack", "plans.md"), "utf-8")
    assert.equal(data, "meu plano", "dados preservados na reativação")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("status de projeto intocado = INATIVO (não cria nada)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-act-"))
  try {
    const { activateCommand } = await load()
    const s = await activateCommand("status", [], { cwd: tmp })
    assert.equal(s.status, "inactive")
    assert.ok(!existsSync(path.join(tmp, ".gstack")), "status não cria .gstack/")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("disable sem .gstack/ = already_inactive (no-op)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-act-"))
  try {
    const { activateCommand } = await load()
    const r = await activateCommand("disable", [], { cwd: tmp })
    assert.equal(r.status, "already_inactive")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("disable com conflito (.gstack-disabled já existe) não sobrescreve", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-act-"))
  try {
    const { activateCommand } = await load()
    await activateCommand("enable", [], { cwd: tmp })
    await mkdir(path.join(tmp, ".gstack-disabled"), { recursive: true })
    const r = await activateCommand("disable", [], { cwd: tmp })
    assert.equal(r.status, "conflict")
    assert.ok(existsSync(path.join(tmp, ".gstack")), ".gstack/ intacto após conflito")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
