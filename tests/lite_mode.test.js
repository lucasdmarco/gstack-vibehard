import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Regressao P2: em modo lite o create nao deve escrever config Casdoor nem
 * anunciar IAM (http://localhost:8000 admin/123) — o servico nao sobe em lite.
 * writeHarnessFiles e exportado para teste do AGENTS.md.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const createModule = path.join(repoRoot, "src", "cli", "create.js")

test("writeHarnessFiles em lite omite IAM/Casdoor do AGENTS.md", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-lite-"))
  try {
    const { writeHarnessFiles } = await import(`${pathToFileURL(createModule)}?t=${Date.now()}`)
    writeHarnessFiles(tmp, "proj", { isLite: true })
    const agents = await readFile(path.join(tmp, "AGENTS.md"), "utf-8")
    assert.ok(!agents.includes("localhost:8000"), "lite nao anuncia IAM localhost:8000")
    assert.ok(!agents.includes("admin/123"), "lite nao anuncia credencial Casdoor")
    assert.ok(agents.includes("Modo lite"), "AGENTS.md indica modo lite")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("writeHarnessFiles em modo completo mantem IAM no AGENTS.md", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-full-"))
  try {
    const { writeHarnessFiles } = await import(`${pathToFileURL(createModule)}?t=${Date.now()}`)
    writeHarnessFiles(tmp, "proj", { isLite: false })
    const agents = await readFile(path.join(tmp, "AGENTS.md"), "utf-8")
    assert.ok(agents.includes("localhost:8000"), "modo completo anuncia IAM")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
