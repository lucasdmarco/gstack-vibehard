import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("MCP policy NEGA tools perigosas por default", async () => {
  const { rufloMcpDecision, RUFLO_MCP_DENY } = await imp("src/harness/ruflo.js")
  for (const t of RUFLO_MCP_DENY) {
    assert.equal(rufloMcpDecision(t).decision, "deny", `${t} deve ser negada`)
  }
  // as exigidas pelo PRD explicitamente
  for (const t of ["terminal", "system", "agent_spawn", "swarm_init", "workflow_delete", "autopilot", "memory_store", "federation"]) {
    assert.equal(rufloMcpDecision(t).decision, "deny")
  }
})

test("substring de tool perigosa também é negada (system_exec, spawn_agent…)", async () => {
  const { rufloMcpDecision } = await imp("src/harness/ruflo.js")
  assert.equal(rufloMcpDecision("system_exec").decision, "deny")
  assert.equal(rufloMcpDecision("terminal_run").decision, "deny")
  assert.equal(rufloMcpDecision("do_agent_spawn").decision, "deny")
})

test("só a allowlist explícita é permitida; o resto é DEFAULT-DENY", async () => {
  const { rufloMcpDecision, RUFLO_MCP_ALLOW } = await imp("src/harness/ruflo.js")
  for (const t of RUFLO_MCP_ALLOW) assert.equal(rufloMcpDecision(t).decision, "allow", `${t} allowlisted`)
  // uma tool desconhecida qualquer → deny por default
  assert.equal(rufloMcpDecision("some_random_tool").decision, "deny")
  assert.equal(rufloMcpDecision("").decision, "deny")
})
