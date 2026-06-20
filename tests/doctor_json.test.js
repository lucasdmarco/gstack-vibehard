import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
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

test("collectDoctorJson: objeto estruturado, EPERM-safe, sem crash em HOME vazio", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-doc-"))
  try {
    const { collectDoctorJson } = await import(`${pathToFileURL(path.join(repoRoot, "src", "installer", "doctor.js"))}?t=${Date.now()}`)
    const r = await collectDoctorJson(home)
    assert.equal(typeof r.ok, "boolean")
    assert.ok(r.versions && "node" in r.versions)
    assert.ok(Array.isArray(r.warnings))
    assert.ok(Array.isArray(r.impactCategories))
    assert.ok(r.integrity && typeof r.integrity.manifestExists === "boolean")
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("doctor --json: stdout é JSON PURO (sem banner/ANSI/prosa)", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-doc-"))
  try {
    const r = run(["doctor", "--json"], { HOME: home, USERPROFILE: home })
    assert.ok(!r.out.includes(ESC), "sem ANSI")
    assert.doesNotMatch(r.out, /Diagnostico do Ambiente|GStack VibeHard Installer/)
    const d = JSON.parse(r.out) // não lança = JSON puro
    assert.equal(typeof d.ok, "boolean")
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("doctor --impact --json: array estruturado puro", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-doc-"))
  try {
    const r = run(["doctor", "--impact", "--json"], { HOME: home, USERPROFILE: home })
    const d = JSON.parse(r.out)
    assert.ok(Array.isArray(d) && d.some((c) => c.category === "hooks"))
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("doctor --install-integrity --strict --json: manifest com problema → exit≠0 + issue no JSON", () => {
  const home = mkdtempSync(path.join(tmpdir(), "gstack-doc-"))
  try {
    mkdirSync(path.join(home, ".gstack_vibehard"), { recursive: true })
    // item com backup ausente → issue → safeToUninstall=false
    writeFileSync(path.join(home, ".gstack_vibehard", "install-manifest.json"), JSON.stringify({
      version: 1,
      items: [{ path: path.join(home, ".claude", "settings.json"), kind: "config", restoreOnUninstall: true, backup: path.join(home, "nao-existe.bak") }],
    }))
    const r = run(["doctor", "--install-integrity", "--strict", "--json"], { HOME: home, USERPROFILE: home })
    assert.equal(r.code, 1, "strict deve falhar com manifest problemático")
    const d = JSON.parse(r.out)
    assert.equal(d.safeToUninstall, false)
    assert.ok(d.issues.length > 0)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
