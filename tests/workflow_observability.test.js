import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "workflow.js")

test("workflow run grava journal; runs e inspect leem (offline)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-wfobs-"))
  try {
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    const { workflowCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)

    // verifier injetado (passa) — não toca rede/testes reais
    const r = await workflowCommand(["run", "--task", "x"], {
      cwd: tmp, runId: "obs1",
      worker: () => ({ ok: true }),
      verifier: () => ({ passed: true, signature: "tests_passed" }),
    })
    assert.equal(r.status, "passed")

    // runs e inspect não devem lançar e devem enxergar o run
    await workflowCommand(["runs"], { cwd: tmp })
    await workflowCommand(["inspect", "obs1"], { cwd: tmp })
    assert.ok(true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("workflow inspect sem runId não quebra (valida antes de ler journal)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-wfinsp-"))
  try {
    const { workflowCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    // Antes do fix isto lançava "path must be of type string" em readJournal.
    await assert.doesNotReject(workflowCommand(["inspect"], { cwd: tmp }))
    // --json sem runId também não quebra
    await assert.doesNotReject(workflowCommand(["inspect", "--json"], { cwd: tmp }))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("workflow run sem --task não executa", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-wfobs2-"))
  try {
    const { workflowCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    const r = await workflowCommand(["run"], { cwd: tmp })
    assert.equal(r, undefined, "sem task não retorna resultado de run")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
