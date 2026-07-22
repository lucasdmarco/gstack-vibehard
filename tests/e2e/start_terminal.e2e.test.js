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
    // PRD48 S48.1: Harness Session Profile anexado ao dry-run — read-only, mesmo perfil
    // pro iniciante (lista curta) e pro power user (JSON).
    assert.equal(d.harnessSession.profiles.length, 3, "claude+codex+opencode")
    assert.ok(["blocked", "local_deterministic", "auto_selected", "ask_user"].includes(d.harnessSession.decision.status))
    // PRD48 S48.2: brownfield discovery read-only anexado ao dry-run — tmp dir vazio -> "new".
    assert.equal(d.brownfield.route, "new")
    assert.equal(existsSync(path.join(cwd, ".gstack")), false, "discovery também não escreve nada")
    // PRD48 S48.3: sessão ativa read-only anexada ao dry-run — sem sessão prévia -> hasActive:false.
    assert.equal(d.activeSession.hasActive, false)
    assert.equal(existsSync(path.join(cwd, ".gstack")), false, "consulta de sessão também não escreve nada")
    // PRD49 S49.1: preview das projeções de design context (PRODUCT.md/DESIGN.md/
    // .impeccable/design.json) anexado ao dry-run — read-only, mesma disciplina.
    assert.match(d.designContext.sourceHash, /^sha256:/)
    assert.deepEqual(d.designContext.files.sort(), ["DESIGN.md", "PRODUCT.md", ".impeccable/design.json"].sort())
    assert.equal(existsSync(path.join(cwd, "PRODUCT.md")), false, "dry-run não escreve as projeções")
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
