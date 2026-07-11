import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD36 36.6 — onboarding determinístico: perguntar (skill) → EXECUTAR → VERIFICAR.
// A honestidade do transcript de campo vira contrato: installed exige artefato
// verificado; fallback/config incompleta = degraded; artefato ausente = failed.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// io fake: controla exit do script e presença/conteúdo dos artefatos.
function fakeIo({ exit = {}, present = new Set(), config = null } = {}) {
  return {
    runScript: ({ script }) => ({ exitCode: exit[script] ?? 0, stderr: "" }),
    exists: (p) => [...present].some((rel) => p.endsWith(rel.replaceAll("/", path.sep)) || p.endsWith(rel)),
    readJson: () => config,
  }
}

const okConfig = { variant: "express", api_dir: "apps/api", db_package: "packages/db" }

test("runOnboarding: script exit 0 + artefato presente + config provada → installed", async () => {
  const { runOnboarding } = await imp("src/skills/onboarding.js")
  const io = fakeIo({ present: new Set([".gstack/config.json"]), config: okConfig })
  const rep = runOnboarding({ projectDir: "/proj", tools: ["gstack"], platform: "linux", io })
  const gstack = rep.results.find((r) => r.tool === "gstack")
  assert.equal(gstack.status, "installed")
  assert.equal(rep.ok, true)
})

test("runOnboarding: FALSO-VERDE do campo — script FALHOU mas artefato existe → degraded (nunca 'sucesso')", async () => {
  const { runOnboarding } = await imp("src/skills/onboarding.js")
  const io = fakeIo({ exit: { "setup-gstack.sh": 1 }, present: new Set([".gstack/config.json"]), config: okConfig })
  const rep = runOnboarding({ projectDir: "/proj", tools: ["gstack"], platform: "linux", io })
  assert.equal(rep.results[0].status, "degraded")
  assert.equal(rep.ok, false, "degraded nunca conta como pronto")
})

test("runOnboarding: config a meio (sem db_package) → degraded mesmo com exit 0", async () => {
  const { runOnboarding } = await imp("src/skills/onboarding.js")
  const io = fakeIo({ present: new Set([".gstack/config.json"]), config: { variant: "express", api_dir: "apps/api" } })
  const rep = runOnboarding({ projectDir: "/proj", tools: ["gstack"], platform: "linux", io })
  assert.equal(rep.results[0].status, "degraded")
})

test("runOnboarding: artefato AUSENTE → failed (marcador não instala — lição superpowers/run.ps1)", async () => {
  const { runOnboarding } = await imp("src/skills/onboarding.js")
  const io = fakeIo({ present: new Set() }) // nada presente
  const rep = runOnboarding({ projectDir: "/proj", tools: ["superpowers"], platform: "linux", io })
  assert.equal(rep.results.find((r) => r.tool === "superpowers").status, "failed")
  assert.equal(rep.ok, false)
})

test("runOnboarding: ferramenta não escolhida → skipped; ok exige installed>0", async () => {
  const { runOnboarding } = await imp("src/skills/onboarding.js")
  const io = fakeIo({ present: new Set([".gbrain/context.json"]) })
  const rep = runOnboarding({ projectDir: "/proj", tools: ["gbrain"], platform: "linux", io })
  assert.equal(rep.results.find((r) => r.tool === "graphify").status, "skipped")
  assert.equal(rep.results.find((r) => r.tool === "gbrain").status, "installed")
  assert.equal(rep.counts.skipped, 4)
})

test("runOnboarding: superpowers verifica run.ps1 no Windows e run.sh no POSIX", async () => {
  const { runOnboarding } = await imp("src/skills/onboarding.js")
  const sp = (rep) => rep.results.find((r) => r.tool === "superpowers").status
  assert.equal(sp(runOnboarding({ projectDir: "/p", tools: ["superpowers"], platform: "win32", io: fakeIo({ present: new Set(["scripts/run.ps1"]) }) })), "installed")
  assert.equal(sp(runOnboarding({ projectDir: "/p", tools: ["superpowers"], platform: "linux", io: fakeIo({ present: new Set(["scripts/run.sh"]) }) })), "installed")
  // no Windows, verificar run.sh (POSIX) deve FALHAR — artefato certo é o .ps1
  assert.equal(sp(runOnboarding({ projectDir: "/p", tools: ["superpowers"], platform: "win32", io: fakeIo({ present: new Set(["scripts/run.sh"]) }) })), "failed")
})

test("CLI onboarding run --json: exit 1 quando não está pronto + grava report", async () => {
  const { onboardingCommand } = await imp("src/commands/onboarding.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-onb-"))
  const prevExit = process.exitCode
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try {
    // roda de verdade num dir vazio pedindo só gbrain: o script real cria o artefato
    await onboardingCommand(["run", "--dir", cwd, "--tools", "gbrain", "--json"], { cwd })
  } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.onboarding.v1")
  assert.ok(existsSync(path.join(cwd, ".gstack", "onboarding", "report.json")))
  process.exitCode = prevExit // não vaza o exitCode do teste
  await rm(cwd, { recursive: true, force: true })
})

test("runOnboarding REAL (win32): roda os 5 setups e todos ficam installed com artefato", { skip: process.platform !== "win32" }, async () => {
  const { runOnboarding } = await imp("src/skills/onboarding.js")
  const proj = await mkdtemp(path.join(tmpdir(), "gstack-onb-real-"))
  try {
    const rep = runOnboarding({ projectDir: proj, tools: ["gstack", "gbrain", "context7", "superpowers", "graphify"], variant: "express" })
    assert.equal(rep.ok, true, JSON.stringify(rep.counts))
    assert.equal(rep.counts.installed, 5)
    for (const r of rep.results) for (const a of r.artifacts) assert.ok(a.present, `${r.tool}: ${a.path} ausente`)
  } finally { await rm(proj, { recursive: true, force: true }) }
})
