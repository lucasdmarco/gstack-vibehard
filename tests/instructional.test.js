import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const instructionalModule = path.join(repoRoot, "src", "harness", "instructional.js")
const detectorModule = path.join(repoRoot, "src", "harness", "detector.js")

test("writeInstructionalGuidance cria arquivo com guidance gstack", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-instr-"))
  try {
    const file = path.join(tmp, "AGENTS.md")
    const { writeInstructionalGuidance } = await import(`${pathToFileURL(instructionalModule)}?t=${Date.now()}`)
    const report = { added: [], updated: [], skipped: [], errors: [] }

    const ok = writeInstructionalGuidance(file, report, () => "")
    assert.equal(ok, true)
    assert.equal(existsSync(file), true)
    const content = await readFile(file, "utf-8")
    assert.ok(content.includes("Quality Gate"))
    assert.ok(content.includes("npx fallow audit"))
    assert.ok(content.includes("Test Gate"))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("writeInstructionalGuidance preserva conteudo do usuario e e idempotente", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-instr-idem-"))
  try {
    const file = path.join(tmp, "GEMINI.md")
    await writeFile(file, "# Minhas regras pessoais\nNao use tabs.\n")
    const { writeInstructionalGuidance } = await import(`${pathToFileURL(instructionalModule)}?t=${Date.now()}`)
    const report = { added: [], updated: [], skipped: [], errors: [] }
    const readFn = async (p) => (existsSync(p) ? readFile(p, "utf-8") : "")

    // 1a escrita: anexa
    writeInstructionalGuidance(file, report, () => "# Minhas regras pessoais\nNao use tabs.\n")
    let content = await readFile(file, "utf-8")
    assert.ok(content.includes("Minhas regras pessoais"), "conteudo do usuario preservado")
    assert.ok(content.includes("gstack_vibehard"))

    // 2a escrita (idempotente): nao duplica o bloco gstack
    writeInstructionalGuidance(file, report, () => content)
    const content2 = await readFile(file, "utf-8")
    const occurrences = content2.split("# gstack_vibehard — Integracao Instrucional").length - 1
    assert.equal(occurrences, 1, "bloco gstack nao duplicado")
    assert.ok(content2.includes("Minhas regras pessoais"))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("detector inclui novos harnesses com instructionFile", async () => {
  const { getHarness } = await import(`${pathToFileURL(detectorModule)}?t=${Date.now()}`)
  for (const id of ["copilot", "droid", "kilocode", "kimi"]) {
    const h = getHarness(id)
    assert.ok(h, `${id} deve existir no detector`)
    assert.equal(typeof h.detect, "function", `${id}.detect deve ser funcao`)
    assert.ok(h.instructionFile, `${id} deve ter instructionFile`)
  }
  // vscode = deteccao apenas (sem instructionFile global)
  const vscode = getHarness("vscode")
  assert.ok(vscode)
  assert.equal(typeof vscode.detect, "function")
  // instrucionais promovidos
  for (const id of ["gemini", "windsurf", "kiro"]) {
    assert.ok(getHarness(id).instructionFile, `${id} deve ter instructionFile`)
  }
})
