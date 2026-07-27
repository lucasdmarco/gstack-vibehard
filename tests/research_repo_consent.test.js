import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.4.3 — `research skills audit --repo <url>` dispara clone/fetch (rede)
 * sem NENHUM gate de consentimento; `mirrorRepo` só clonava uma vez, nunca
 * atualizava (staleness silenciosa). Usa um repo git REAL local como "remoto"
 * (git aceita path local como remote) — sem rede de verdade, mesmo mecanismo.
 */

async function realRemote(cwd) {
  const remote = path.join(cwd, "remote")
  await mkdir(remote, { recursive: true })
  execFileSync("git", ["init"], { cwd: remote, stdio: "pipe" })
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: remote, stdio: "pipe" })
  execFileSync("git", ["config", "user.name", "t"], { cwd: remote, stdio: "pipe" })
  await writeFile(path.join(remote, "SKILL.md"), "# skill v1 (sem risco)\n")
  execFileSync("git", ["add", "-A"], { cwd: remote, stdio: "pipe" })
  execFileSync("git", ["commit", "-m", "v1"], { cwd: remote, stdio: "pipe" })
  return remote
}

async function captureStdout(fn) {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += String(s); return true }
  try { await fn() } finally { process.stdout.write = orig }
  return out.trim().split("\n").pop()
}

test("research skills audit --repo SEM --yes (não-interativo): recusa honesta, nenhum clone acontece", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-research-1-"))
  try {
    const remote = await realRemote(cwd)
    const { researchCommand } = await imp("src/commands/research.js")
    const out = JSON.parse(await captureStdout(() => researchCommand(["skills", "audit", "--repo", remote, "--json"], { cwd })))
    assert.equal(out.error, "needs_confirmation")
    assert.ok(!existsSync(path.join(cwd, ".gstack", "research", "mirrors")), "nenhum clone sem consentimento")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("research skills audit --repo: usuário recusa no prompt (confirm injetado) -> cancelado, nada clonado", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-research-2-"))
  try {
    const remote = await realRemote(cwd)
    const { researchCommand } = await imp("src/commands/research.js")
    const out = JSON.parse(await captureStdout(() => researchCommand(["skills", "audit", "--repo", remote, "--json"], { cwd, confirm: async () => false })))
    assert.equal(out.cancelled, true)
    assert.ok(!existsSync(path.join(cwd, ".gstack", "research", "mirrors")))
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("research skills audit --repo --yes: clona de verdade e audita com o commit real do remoto", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-research-3-"))
  try {
    const remote = await realRemote(cwd)
    const remoteHead = execFileSync("git", ["-C", remote, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim()
    const { researchCommand } = await imp("src/commands/research.js")
    const out = JSON.parse(await captureStdout(() => researchCommand(["skills", "audit", "--repo", remote, "--json", "--yes"], { cwd })))
    assert.equal(out.provenance.commit, remoteHead)
    assert.equal(out.provenance.auditedFiles, 1)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("research skills audit --repo --yes: 2ª chamada ATUALIZA o mirror (staleness corrigida, não serve snapshot velho)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-research-4-"))
  try {
    const remote = await realRemote(cwd)
    const { researchCommand } = await imp("src/commands/research.js")
    const first = JSON.parse(await captureStdout(() => researchCommand(["skills", "audit", "--repo", remote, "--json", "--yes"], { cwd })))
    assert.equal(first.provenance.auditedFiles, 1)

    // novo commit no "remoto" DEPOIS do 1º clone
    await writeFile(path.join(remote, "AGENTS.md"), "# outro arquivo\n")
    execFileSync("git", ["add", "-A"], { cwd: remote, stdio: "pipe" })
    execFileSync("git", ["commit", "-m", "v2"], { cwd: remote, stdio: "pipe" })
    const newHead = execFileSync("git", ["-C", remote, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim()

    const second = JSON.parse(await captureStdout(() => researchCommand(["skills", "audit", "--repo", remote, "--json", "--yes"], { cwd })))
    assert.equal(second.provenance.commit, newHead, "2ª auditoria reflete o commit NOVO, não o snapshot do 1º clone")
    assert.equal(second.provenance.auditedFiles, 2, "arquivo novo aparece -- mirror foi atualizado de verdade")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
