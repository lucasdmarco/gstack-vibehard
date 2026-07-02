import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// exec fake: registry oficial + versões de binário
const execOfficial = (file, args) => {
  if (file === "npm" && args[0] === "config") return "https://registry.npmjs.org\n"
  return "v1.0.0\n"
}

test("supply chain: registry oficial + binários presentes → risk none", async () => {
  const { buildSupplyChainReport } = await imp("src/installer/supply-chain.js")
  const r = buildSupplyChainReport({ exec: execOfficial, env: process.env })
  assert.equal(r.schemaVersion, "gstack.supplychain.v1")
  const reg = r.checks.find((c) => c.id === "npm-registry")
  assert.equal(reg.status, "ok")
  assert.ok(r.officialSources.npm.includes("npmjs.com"))
  assert.ok(r.checks.some((c) => c.id === "remote-allowlist" && c.status === "ok"))
})

test("supply chain: registry MIRROR não oficial → critical + risk high", async () => {
  const { buildSupplyChainReport } = await imp("src/installer/supply-chain.js")
  const execMirror = (file, args) => {
    if (file === "npm" && args[0] === "config") return "https://registry.espelho-suspeito.example\n"
    return "v1.0.0\n"
  }
  const r = buildSupplyChainReport({ exec: execMirror, env: process.env })
  const reg = r.checks.find((c) => c.id === "npm-registry")
  assert.equal(reg.status, "critical")
  assert.match(reg.detail, /risco de malware/)
  assert.equal(r.risk, "high")
})

test("supply chain: npm indisponível → warning honesto (não crash, não OK falso)", async () => {
  const { buildSupplyChainReport } = await imp("src/installer/supply-chain.js")
  const execBroken = () => { throw new Error("ENOENT") }
  const r = buildSupplyChainReport({ exec: execBroken, env: { PATH: "" } })
  const reg = r.checks.find((c) => c.id === "npm-registry")
  assert.equal(reg.status, "warning")
  assert.ok(r.risk === "low" || r.risk === "high", "sem npm nunca é risk none")
})

test("binário crítico em local SUSPEITO (temp/cwd) → critical (PATH hijack)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-sc-"))
  try {
    const fake = process.platform === "win32" ? "git.cmd" : "git"
    await writeFile(path.join(dir, fake), "echo fake")
    const { buildSupplyChainReport, isSuspiciousLocation, resolveBin } = await imp("src/installer/supply-chain.js")
    // resolveBin acha o fake no PATH injetado (dir está no tmp → suspeito)
    const found = resolveBin("git", { PATH: dir })
    assert.ok(found && found.startsWith(dir))
    assert.equal(isSuspiciousLocation(found), true)
    const r = buildSupplyChainReport({ exec: execOfficial, env: { PATH: dir } })
    const git = r.checks.find((c) => c.id === "bin:git")
    assert.equal(git.status, "critical")
    assert.match(git.detail, /PATH hijack/)
    assert.equal(r.risk, "high")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("binário crítico AUSENTE → warning; opcional ausente → ok", async () => {
  const { buildSupplyChainReport } = await imp("src/installer/supply-chain.js")
  const r = buildSupplyChainReport({ exec: execOfficial, env: { PATH: "" } })
  assert.equal(r.checks.find((c) => c.id === "bin:git").status, "warning")
  assert.equal(r.checks.find((c) => c.id === "bin:bun").status, "ok", "opcional ausente não é problema")
})

test("riskLevel: critical > warning > none", async () => {
  const { riskLevel } = await imp("src/installer/supply-chain.js")
  assert.equal(riskLevel([{ status: "ok" }]), "none")
  assert.equal(riskLevel([{ status: "ok" }, { status: "warning" }]), "low")
  assert.equal(riskLevel([{ status: "warning" }, { status: "critical" }]), "high")
})
