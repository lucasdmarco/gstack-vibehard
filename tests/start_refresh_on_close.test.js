import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.5.2 (ação #1) — "no closeout, após o commit final: atualizar
 * contexto; atualizar Graphify; gerar readiness; registrar hashes e HEAD;
 * verificar de novo". `buildToolRefresh` já existe (tools/refresh.js) mas
 * nunca era injetado em `runCloseoutSync` em nenhum call site real
 * (`toolsRefresh` sempre "not_run"). Flag própria `--refresh-on-close`
 * (default OFF) — pesado (graphify+context+fallow), então nunca roda sem
 * opt-in explícito, e só quando a run fecha com sucesso real (status "done").
 */

function realGitProject(cwd) {
  const proj = path.join(cwd, "app")
  execFileSync("git", ["init", proj], { stdio: "pipe" })
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: proj, stdio: "pipe" })
  execFileSync("git", ["config", "user.name", "t"], { cwd: proj, stdio: "pipe" })
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: proj, stdio: "pipe" })
  return proj
}

test("--refresh-on-close: refresh injetado roda quando a run fecha 'done', closeout reflete o resultado", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-refresh-close-"))
  try {
    realGitProject(cwd)
    let called = 0
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand(["--golden-run", "--refresh-on-close"], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
      journeys: [{ acceptanceId: "feature-behavior", method: "command", ref: "npm test", files: [] }],
      proofRunner: async () => ({ ready: true, blockers: [] }),
      refreshRunner: () => { called++; return { state: "ok", steps: [{ tool: "graphify", status: "ok" }], provenance: { builtAtCommit: "abc123" } } },
    })
    assert.equal(r.pipeline.status, "done")
    assert.equal(called, 1, "refresh injetado rodou exatamente uma vez")
    const closeoutPath = path.join(cwd, ".gstack", "runs", r.pipeline.runId, "closeout.json")
    const closeout = JSON.parse(await readFile(closeoutPath, "utf-8"))
    assert.equal(closeout.toolsRefresh.state, "ok")
    assert.equal(closeout.toolsRefresh.provenance.builtAtCommit, "abc123")
    assert.equal(closeout.fresh, true, "refresh ok -> fresh:true (closeout.js:isFresh)")
  } finally { cleanupTmp(cwd) }
})

test("sem --refresh-on-close: toolsRefresh continua 'not_run' (comportamento original preservado, zero regressão)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-refresh-close-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand([], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
    })
    const closeoutPath = path.join(cwd, ".gstack", "runs", r.pipeline.runId, "closeout.json")
    const closeout = JSON.parse(await readFile(closeoutPath, "utf-8"))
    assert.equal(closeout.toolsRefresh.state, "not_run")
  } finally { cleanupTmp(cwd) }
})

test("--refresh-on-close SEM 'done' (gate falho -> handoff): refresh NÃO roda (só em run bem-sucedida)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-refresh-close-"))
  try {
    let called = 0
    const { startCommand } = await imp("src/commands/start.js")
    // sem journeys/git real -> acceptance não resolve -> gate falho -> handoff, nunca "done"
    const r = await startCommand(["--golden-run", "--refresh-on-close"], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
      proofRunner: async () => ({ ready: false, blockers: ["release-source-parity: sem remoto"] }),
      refreshRunner: () => { called++; return { state: "ok" } },
    })
    assert.notEqual(r.pipeline.status, "done")
    assert.equal(called, 0, "refresh nunca roda em run que não fechou 'done'")
  } finally { cleanupTmp(cwd) }
})

test("GSTACK_REFRESH_ON_CLOSE=1 (env var): mesmo efeito da flag CLI", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-refresh-close-"))
  const prev = process.env.GSTACK_REFRESH_ON_CLOSE
  try {
    realGitProject(cwd)
    process.env.GSTACK_REFRESH_ON_CLOSE = "1"
    let called = 0
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand(["--golden-run"], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
      journeys: [{ acceptanceId: "feature-behavior", method: "command", ref: "npm test", files: [] }],
      proofRunner: async () => ({ ready: true, blockers: [] }),
      refreshRunner: () => { called++; return { state: "ok" } },
    })
    assert.equal(r.pipeline.status, "done")
    assert.equal(called, 1)
  } finally {
    if (prev === undefined) delete process.env.GSTACK_REFRESH_ON_CLOSE
    else process.env.GSTACK_REFRESH_ON_CLOSE = prev
    cleanupTmp(cwd)
  }
})
