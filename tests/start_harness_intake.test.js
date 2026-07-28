import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.7.1 — PRD48 S48.1 já tinha as peças puras (detectTargetProfiles/
 * decideFirstRun/applyFirstRunChoice/buildLocalProfileUpdate) mas nada no
 * caminho interativo real do `start` as chamava — só o preview de
 * `--dry-run`. Este teste prova o wiring REAL: pergunta quando há mais de
 * um harness apto, nunca decide sozinho, persiste SÓ com consentimento
 * explícito, e lembra a preferência em runs futuros (não pergunta de novo).
 */

const twoApt = () => ([
  { harness: "claude", installed: true, callable: true, enforcement: "native_enforced" },
  { harness: "codex", installed: true, callable: true, enforcement: "adapter_enforced" },
])
const oneApt = () => ([{ harness: "claude", installed: true, callable: true, enforcement: "native_enforced" }])

test("start interativo: >1 harness apto -> pergunta de verdade (nunca decide sozinho)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-harness-intake-"))
  try {
    let asked = null
    const r = await startCommand([], {
      cwd: dir, objective: "cli tool", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => false, exec: () => {},
      detectHarnessProfiles: twoApt,
      select: async (q, choices) => { if (/harness/i.test(q)) { asked = { q, choices }; return "codex" } return choices[0] },
    })
    assert.ok(asked, "a pergunta de harness foi feita de verdade")
    assert.deepEqual(asked.choices.sort(), ["claude", "codex"])
    assert.equal(r.harnessIntake.applied.harness, "codex", "escolha do usuário respeitada")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("start --yes (não-interativo): >1 harness apto NUNCA inventa escolha, nunca persiste", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-harness-intake-"))
  try {
    const r = await startCommand(["--yes"], {
      cwd: dir, objective: "cli tool", projectName: "app", mode: "lite", designSystem: "none",
      exec: () => {}, detectHarnessProfiles: twoApt,
    })
    assert.equal(r.harnessIntake.decision.status, "ask_user")
    assert.equal(r.harnessIntake.applied, undefined, "--yes nunca escolhe sozinho")
    assert.equal(existsSync(path.join(dir, ".gstack", "config.local.json")), false, "nada persistido sem consentimento")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("persistência SÓ com consentimento explícito (confirm:true) — grava config.local.json de verdade", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-harness-intake-"))
  try {
    const r = await startCommand([], {
      cwd: dir, objective: "cli tool", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      detectHarnessProfiles: twoApt,
      select: async (q, choices) => (/harness/i.test(q) ? "claude" : choices[0]),
    })
    assert.equal(r.harnessIntake.persisted, true)
    const onDisk = JSON.parse(await readFile(path.join(dir, ".gstack", "config.local.json"), "utf-8"))
    assert.equal(onDisk.preferredHarness, "claude")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("preferência já lembrada (config.local.json) -> NÃO pergunta de novo, auto-seleciona", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const { writeLocalProfileUpdate } = await imp("src/policy/layers.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-harness-intake-"))
  try {
    writeLocalProfileUpdate(dir, { schemaVersion: "gstack.local-profile.v1", preferredHarness: "codex", preferredModel: "auto" })
    let asked = false
    const r = await startCommand([], {
      cwd: dir, objective: "cli tool", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      detectHarnessProfiles: twoApt,
      select: async (q, choices) => { if (/harness/i.test(q)) asked = true; return choices[0] },
    })
    assert.equal(asked, false, "preferência lembrada -> nunca pergunta de novo")
    assert.equal(r.harnessIntake.fromMemory, true)
    assert.equal(r.harnessIntake.applied.harness, "codex")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("exatamente 1 harness apto -> auto_selected, nunca pergunta", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-harness-intake-"))
  try {
    let asked = false
    const r = await startCommand([], {
      cwd: dir, objective: "cli tool", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      detectHarnessProfiles: oneApt,
      select: async (q, choices) => { if (/harness/i.test(q)) asked = true; return choices[0] },
    })
    assert.equal(asked, false)
    assert.equal(r.harnessIntake.decision.status, "auto_selected")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("nenhum harness apto e tarefa exige LLM -> blocked, aviso honesto, nunca trava o start", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-harness-intake-"))
  try {
    const r = await startCommand([], {
      cwd: dir, objective: "cli tool", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      detectHarnessProfiles: () => [],
    })
    assert.equal(r.harnessIntake.decision.status, "blocked")
    // "blocked" é aviso honesto nesta leva (aditivo) -- não vira hard-gate novo, o start segue.
    assert.equal(r.executed, true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
