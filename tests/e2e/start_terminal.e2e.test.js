// Terminal E2E (caixa-preta) do `start` + fluxos centrais read-only (policy/scout).
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const bin = path.resolve(import.meta.dirname, "..", "..", "src", "index.js")

function run(args, cwd) {
  try { return { code: 0, out: execFileSync("node", [bin, ...args], { cwd, encoding: "utf-8", stdio: "pipe" }) } }
  catch (e) { return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + "" } }
}

test("E2E start --dry-run --json: JSON puro e NADA é escrito no disco", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-e2e-start-"))
  try {
    const r = run(["start", "app de teste", "--name", "t", "--dry-run", "--json"], cwd)
    const d = JSON.parse(r.out)
    assert.equal(d.dryRun, true)
    assert.ok(d.plan && d.plan.id)
    assert.equal(existsSync(path.join(cwd, ".gstack")), false, "dry-run não escreve .gstack")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("E2E policy doctor --json: JSON puro (precedência declarada), read-only", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-e2e-start-"))
  try {
    const d = JSON.parse(run(["policy", "doctor", "--json"], cwd).out)
    assert.equal(typeof d.valid, "boolean")
    assert.ok(Array.isArray(d.layers))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("E2E context scout --json: read-only, devolve paths+razão (nunca dump)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-e2e-start-"))
  try {
    const d = JSON.parse(run(["context", "scout", "objetivo de teste", "--json"], cwd).out)
    assert.equal(d.ok, true)
    assert.ok(Array.isArray(d.results))
    assert.ok(Array.isArray(d.backendsUsed))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
