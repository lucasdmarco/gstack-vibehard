// Terminal E2E (caixa-preta) do `doctor` (PRD18 Sprint 9). Roda o BINÁRIO real e
// valida contrato de saída: JSON puro, read-only, conformance/candidates/ruflo.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const bin = path.resolve(import.meta.dirname, "..", "..", "src", "index.js")
const ESC = String.fromCharCode(27)

function run(args, env = {}) {
  try { return { code: 0, out: execFileSync("node", [bin, ...args], { encoding: "utf-8", env: { ...process.env, ...env }, stdio: "pipe" }) } }
  catch (e) { return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + "" } }
}

test("E2E doctor --json: JSON puro, sem ANSI/banner, com conformance", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-e2e-doc-"))
  try {
    const r = run(["doctor", "--json"], { HOME: home, USERPROFILE: home })
    assert.ok(!r.out.includes(ESC), "sem ANSI")
    const d = JSON.parse(r.out)
    assert.equal(typeof d.ok, "boolean")
    assert.ok(d.conformance && typeof d.conformance.ok === "boolean")
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("E2E doctor --conformance --strict --json: matriz honesta → exit 0", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-e2e-doc-"))
  try {
    const r = run(["doctor", "--conformance", "--strict", "--json"], { HOME: home, USERPROFILE: home })
    assert.equal(r.code, 0)
    assert.equal(JSON.parse(r.out).ok, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("E2E doctor --candidates / --ruflo: read-only, JSON puro", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-e2e-doc-"))
  try {
    const cand = JSON.parse(run(["doctor", "--candidates", "--json"], { HOME: home, USERPROFILE: home }).out)
    assert.equal(cand.readonly, true)
    const ruflo = JSON.parse(run(["doctor", "--ruflo", "--json"], { HOME: home, USERPROFILE: home }).out)
    assert.equal(ruflo.fullInitRecommended, false)
    assert.equal(ruflo.mcpPolicy.default, "deny")
  } finally { rmSync(home, { recursive: true, force: true }) }
})
