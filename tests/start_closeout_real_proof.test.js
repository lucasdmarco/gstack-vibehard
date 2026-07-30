import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.2.6 (ação #9) — closeout consome o proof REAL quando ele rodou nesta
 * run. Achado: `finishPipeline` (run-loop.js) já roda o closeout ANTES do proof
 * existir (proof só roda depois, em `start.js`) — `runCloseoutSync` é idempotente
 * por runId, então re-sincronizamos com o proof real depois que ele roda.
 *
 * Nota pós-S51.2.7: com o cutover, `status` só vira "done"/sucesso quando o motor
 * fecha os 4 portões — por isso este teste monta um projeto real (git limpo +
 * acceptance resolvida) em vez de depender só do `exec` fake.
 */

test("closeout.json reflete o proof REAL (não o proxy verify-gate) quando --golden-run roda proof automático", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-closeout-1-"))
  try {
    const proj = path.join(cwd, "app")
    await mkdir(proj, { recursive: true })
    execFileSync("git", ["init"], { cwd: proj, stdio: "pipe" })
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: proj, stdio: "pipe" })
    execFileSync("git", ["config", "user.name", "t"], { cwd: proj, stdio: "pipe" })
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: proj, stdio: "pipe" })
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand(["--golden-run"], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
      journeys: [{ acceptanceId: "feature-behavior", method: "command", ref: "npm test", files: [] }],
      // verify-gate real (usado por closeoutReadiness) diria ready:true; o proof
      // REAL diz ready:false com um blocker — closeout precisa refletir o REAL.
      proofRunner: async () => ({ ready: false, blockers: ["release-source-parity: sem remoto"] }),
    })
    assert.equal(r.pipeline.status, "done", "os 4 portões fecharam -> done -> proof automático roda")
    const closeoutPath = path.join(cwd, ".gstack", "runs", r.pipeline.runId, "closeout.json")
    const closeout = JSON.parse(await readFile(closeoutPath, "utf-8"))
    assert.equal(closeout.proof.state, "ran")
    assert.equal(closeout.proof.ready, false, "closeout reflete o proof REAL (ready:false), não o proxy verify-gate")
    assert.deepEqual(closeout.proof.blockers, ["release-source-parity: sem remoto"])
  } finally { cleanupTmp(cwd) }
})

test("closeout.json NÃO é resincronizado quando proof não rodou (sem --golden-run/--proof) — comportamento original preservado", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-closeout-2-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand([], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
    })
    const closeoutPath = path.join(cwd, ".gstack", "runs", r.pipeline.runId, "closeout.json")
    const closeout = JSON.parse(await readFile(closeoutPath, "utf-8"))
    // sem proof real, o closeout original (verify-gate proxy) continua de pé
    assert.equal(closeout.proof.state, "ran", "closeoutReadiness (proxy) ainda roda — comportamento pré-S51.2.6 intacto")
  } finally { cleanupTmp(cwd) }
})
