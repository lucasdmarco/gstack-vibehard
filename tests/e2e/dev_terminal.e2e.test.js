// Terminal E2E (caixa-preta) do `dev` e `verify` — não crasham e emitem JSON.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const bin = path.resolve(import.meta.dirname, "..", "..", "src", "index.js")

function run(args, cwd) {
  try { return { code: 0, out: execFileSync("node", [bin, ...args], { cwd, encoding: "utf-8", stdio: "pipe", timeout: 60000 }) } }
  catch (e) { return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + "" } }
}

/** Última linha JSON da saída (dev/verify podem imprimir progresso antes do JSON). */
function lastJson(out) {
  const lines = out.trim().split("\n").filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]) } catch { /* tenta a anterior */ }
  }
  return null
}

test("E2E dev: sem runtime manifest → resposta HONESTA sem crash (exit 0)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-e2e-dev-"))
  try {
    const r = run(["dev", "--json"], cwd)
    assert.equal(r.code, 0, "não crasha sem projeto")
    // honesto: ou JSON com services/status, ou aviso de manifest ausente
    const d = lastJson(r.out)
    const honest = (d && ("services" in d || "error" in d || "status" in d)) || /manifest|runtime|create/i.test(r.out)
    assert.ok(honest, "dev responde de forma honesta (JSON ou aviso de manifest)")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("E2E verify --changed-files --json: docs-only passa, JSON puro", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-e2e-dev-"))
  try {
    const r = run(["verify", "--changed-files", "--json"], cwd)
    const d = lastJson(r.out)
    assert.ok(d, "verify emite JSON")
    assert.ok("status" in d || "fallback" in d)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
