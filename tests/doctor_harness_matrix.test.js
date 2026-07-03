import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const bin = path.join(repoRoot, "src", "index.js")
const ESC = String.fromCharCode(27)

function run(args, env = {}) {
  try {
    const out = execFileSync("node", [bin, ...args], { encoding: "utf-8", env: { ...process.env, ...env }, stdio: "pipe" })
    return { code: 0, out }
  } catch (e) {
    return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + "" }
  }
}

test("collectDoctorJson: campo conformance resumido, coerente e sem claim falsa", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-doc-"))
  try {
    const { collectDoctorJson } = await import(`${pathToFileURL(path.join(repoRoot, "src", "installer", "doctor.js"))}?t=${Date.now()}`)
    const r = await collectDoctorJson(home)
    assert.ok(r.conformance, "doctor --json reporta conformance")
    assert.equal(r.conformance.ok, true)
    assert.equal(r.conformance.totalViolations, 0)
    const h = r.conformance.harnesses
    // Claude/Cursor/OpenCode/Codex/Devin + instrucional presentes
    for (const id of ["claude", "cursor", "opencode", "codex", "devin", "gemini"]) assert.ok(h[id], `harness ${id}`)
    // real_hooks pode ter enforced; instrucional NUNCA (nada de Zero-Trust falso)
    assert.ok(h.claude.enforcedEvents > 0)
    assert.equal(h.gemini.enforcement, "instructional")
    assert.equal(h.gemini.enforcedEvents, 0, "harness instrucional jamais aparece com enforced")
    for (const id of Object.keys(h)) {
      if (h[id].enforcement === "instructional") assert.equal(h[id].enforcedEvents, 0, `${id} instrucional sem enforced`)
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("doctor --conformance --json: JSON PURO por harness (enforced/partial/advisory)", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-doc-"))
  try {
    const r = run(["doctor", "--conformance", "--json"], { HOME: home, USERPROFILE: home })
    assert.ok(!r.out.includes(ESC), "sem ANSI")
    const d = JSON.parse(r.out) // não lança = JSON puro
    assert.equal(d.schemaVersion, "gstack.conformance.v1")
    assert.equal(d.ok, true)
    assert.ok(d.harnesses.claude.enforcedEvents.includes("tool.before"))
    assert.equal(d.harnesses.gemini.enforcedEvents.length, 0)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("doctor --conformance --strict --json: sem violações → exit 0", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-doc-"))
  try {
    const r = run(["doctor", "--conformance", "--strict", "--json"], { HOME: home, USERPROFILE: home })
    assert.equal(r.code, 0, "matriz honesta não tem violação → strict passa")
  } finally { rmSync(home, { recursive: true, force: true }) }
})
