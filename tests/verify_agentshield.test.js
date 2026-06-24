import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "commands", "verify.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

async function project() {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-as-"))
  await writeFile(path.join(cwd, "AGENTS.md"), "# Regras do projeto\n")
  return cwd
}

test("verify --agentshield: ECC AgentShield roda como ADVISORY (exec injetado)", async () => {
  const cwd = await project()
  try {
    const { verifyCommand } = await imp()
    const exec = () => "AgentShield: 0 prompt-injection issues"
    const r = await verifyCommand(["--agentshield", "--json"], { cwd, exec, runId: "t1" })
    assert.equal(r.agentShield.status, "advisory")
    assert.match(r.agentShield.detail, /AGENTS\.md/)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("verify --agentshield: falha do AgentShield NÃO bloqueia (status unavailable)", async () => {
  const cwd = await project()
  try {
    const { verifyCommand } = await imp()
    const exec = () => { throw new Error("npx offline") }
    const r = await verifyCommand(["--agentshield", "--json"], { cwd, exec, runId: "t2" })
    assert.equal(r.agentShield.status, "unavailable")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("verify SEM --agentshield: não roda AgentShield (opt-in)", async () => {
  const cwd = await project()
  try {
    const { verifyCommand } = await imp()
    const r = await verifyCommand(["--json"], { cwd, exec: () => "x", runId: "t3" })
    assert.equal(r.agentShield, undefined, "AgentShield só roda com --agentshield/GSTACK_AGENTSHIELD")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
