import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD37 37.4 (D4) — checkpoints Replit-like: snapshot real de código + contexto,
// rollback ao último ponto VERDE. NÃO é git commit; só restaura o capturado.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

async function tempProject() {
  const root = await mkdtemp(path.join(tmpdir(), "gstack-ckpt-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "app.js"), "v1")
  return root
}

test("createCheckpoint: snapshot real de código com sha256 + contexto; seq incrementa", async () => {
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await tempProject()
  try {
    const state = { intent: "implementar x", phase: "checkpoint", verdict: "validated", consumed: { iterations: 1 } }
    const c1 = createCheckpoint({ root, runId: "r", files: ["src/app.js"], state, green: true, note: "verde" })
    assert.equal(c1.seq, 1)
    assert.equal(c1.hasCode, true)
    assert.equal(c1.files[0].bytes, 2)
    assert.ok(c1.files[0].sha256)
    assert.equal(c1.context.intent, "implementar x")
    assert.ok(existsSync(path.join(root, ".gstack", "runs", "r", "checkpoints", "1", "files", "src", "app.js")))
    const c2 = createCheckpoint({ root, runId: "r", files: [], state, green: false })
    assert.equal(c2.seq, 2)
    assert.equal(c2.hasCode, false, "sem files → só contexto, não mente que salvou código")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("createCheckpoint: arquivo ausente é marcado missing (nunca finge captura)", async () => {
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await tempProject()
  try {
    const c = createCheckpoint({ root, runId: "r", files: ["src/naoexiste.js"] })
    assert.equal(c.files[0].missing, true)
    assert.equal(c.hasCode, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("lastGreenCheckpoint: só considera checkpoints green", async () => {
  const { createCheckpoint, lastGreenCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await tempProject()
  try {
    createCheckpoint({ root, runId: "r", files: ["src/app.js"], green: true })
    createCheckpoint({ root, runId: "r", files: ["src/app.js"], green: false })
    assert.equal(lastGreenCheckpoint({ root, runId: "r" }).seq, 1, "o não-verde (#2) não conta")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("rollbackToLastGreen: restaura o conteúdo do último verde ao working tree", async () => {
  const { createCheckpoint, rollbackToLastGreen } = await imp("src/skills/loop-checkpoint.js")
  const root = await tempProject()
  const appPath = path.join(root, "src", "app.js")
  try {
    createCheckpoint({ root, runId: "r", files: ["src/app.js"], green: true }) // captura "v1"
    writeFileSync(appPath, "v2-quebrado")                                       // regressão no working tree
    assert.equal(readFileSync(appPath, "utf-8"), "v2-quebrado")
    const r = rollbackToLastGreen({ root, runId: "r" })
    assert.equal(r.ok, true)
    assert.deepEqual(r.restored, ["src/app.js"])
    assert.equal(readFileSync(appPath, "utf-8"), "v1", "voltou ao último ponto verde")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("rollbackToLastGreen: sem checkpoint verde falha honestamente", async () => {
  const { createCheckpoint, rollbackToLastGreen } = await imp("src/skills/loop-checkpoint.js")
  const root = await tempProject()
  try {
    createCheckpoint({ root, runId: "r", files: ["src/app.js"], green: false })
    const r = rollbackToLastGreen({ root, runId: "r" })
    assert.equal(r.ok, false)
    assert.match(r.reason, /nenhum checkpoint verde/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("rollbackToCheckpoint: seq inexistente falha; NÃO é git (só o snapshot)", async () => {
  const { rollbackToCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await tempProject()
  try {
    const r = rollbackToCheckpoint({ root, runId: "r", seq: 99 })
    assert.equal(r.ok, false)
    assert.match(r.reason, /inexistente/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("CLI loop checkpoint + rollback: cria verde e volta a ele", async () => {
  const { loopCommand } = await imp("src/commands/loop.js")
  const root = await tempProject()
  const appPath = path.join(root, "src", "app.js")
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  try {
    process.stdout.write = (s) => { out += s; return true }
    await loopCommand(["checkpoint", "--run", "c", "--files", "src/app.js", "--green", "--json"], { cwd: root })
    writeFileSync(appPath, "regressao")
    out = ""
    await loopCommand(["rollback", "--run", "c", "--json"], { cwd: root })
  } finally { process.stdout.write = orig }
  const payload = JSON.parse(out.trim().split("\n").pop())
  assert.equal(payload.rollback.ok, true)
  assert.equal(readFileSync(appPath, "utf-8"), "v1")
  await rm(root, { recursive: true, force: true })
})
