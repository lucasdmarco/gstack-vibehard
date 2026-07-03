import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// exec fake do Devin via tabela de rotas (mantém a complexidade baixa p/ o QG).
function makeDevinExec({ runOk = true, tracked = "", changed = ["a.js"] } = {}) {
  const state = { ranArgs: null }
  const routes = {
    "devin --version": () => Buffer.from("devin 1.0"),
    "devin -p": (args) => {
      state.ranArgs = args
      if (runOk) return Buffer.from("tarefa concluída")
      const e = new Error("boom"); e.status = 1; e.stderr = "erro devin"; throw e
    },
    "git ls-files": () => Buffer.from(tracked),
    "git rev-parse": () => Buffer.from("true"),
    "git status": () => Buffer.from(changed.map((f) => " M " + f).join("\n")),
  }
  const exec = (file, args) => {
    const fn = routes[`${file} ${args[0]}`] || (file === "git" ? () => Buffer.from("") : null)
    if (!fn) throw new Error("unexpected " + file)
    return fn(args)
  }
  return { exec, ranArgs: () => state.ranArgs }
}

test("runDevinDelegation: Devin ausente → devin_missing; task inválida → invalid_task", async () => {
  const { runDevinDelegation } = await imp("src/delegation/devin.js")
  assert.equal(runDevinDelegation({ task: "x", cwd: "/x", exec: () => { throw new Error("no devin") } }).status, "devin_missing")
  const ok = makeDevinExec()
  assert.equal(runDevinDelegation({ task: "linha1\nlinha2", cwd: "/x", exec: ok.exec }).status, "invalid_task")
})

test("runDevinDelegation: sucesso roda `devin -p -- <task>` e retorna estruturado", async () => {
  const { runDevinDelegation } = await imp("src/delegation/devin.js")
  const m = makeDevinExec({ changed: ["src/x.js"] })
  const r = runDevinDelegation({ task: "corrigir auth", cwd: "/x", model: "swe", exec: m.exec })
  assert.equal(r.status, "ok")
  assert.deepEqual(r.changedFiles, ["src/x.js"])
  const args = m.ranArgs()
  assert.deepEqual(args, ["-p", "--model", "swe", "--", "corrigir auth"], "oneshot com model e -- separando o prompt")
})

test("runDevinDelegation: falha do Devin captura exitCode/stderr tipado", async () => {
  const { runDevinDelegation } = await imp("src/delegation/devin.js")
  const r = runDevinDelegation({ task: "x", cwd: "/x", exec: makeDevinExec({ runOk: false }).exec })
  assert.equal(r.status, "failed")
  assert.equal(r.exitCode, 1)
  assert.match(r.stderrTail, /erro devin/)
})

test("delegate devin: .env rastreado → BLOQUEIA e não chama Devin", async () => {
  const { delegateCommand } = await imp("src/commands/delegate.js")
  const m = makeDevinExec({ tracked: ".env\0" })
  const r = await delegateCommand(["devin", "--task", "x", "--worktree", "--yes"], { cwd: "/x", exec: m.exec })
  assert.equal(r.status, "blocked_tracked_secrets")
  assert.equal(m.ranArgs(), null, "não delegou com segredo rastreado")
})

test("delegate devin --cloud-handoff: sem confirmação (non-TTY) → nada é enviado", async () => {
  const { delegateCommand } = await imp("src/commands/delegate.js")
  const m = makeDevinExec()
  const r = await delegateCommand(["devin", "--task", "x", "--cloud-handoff", "--yes"], { cwd: "/x", exec: m.exec })
  assert.equal(r.status, "cloud_handoff_declined")
  assert.equal(m.ranArgs(), null, "cloud handoff sem confirmação não roda o Devin")
})

test("delegate devin --cloud-handoff: confirmado (TTY) → prossegue com cloudHandoff=true e provenance", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-deldevin-"))
  const realTTY = process.stdin.isTTY
  try {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    const { delegateCommand } = await imp("src/commands/delegate.js")
    const { readAllReceipts } = await imp("src/vfa/provenance.js")
    const m = makeDevinExec({ changed: ["a.js"] })
    const r = await delegateCommand(["devin", "--task", "revisar", "--cloud-handoff", "--yes"], { cwd, exec: m.exec, confirm: async () => true })
    assert.equal(r.status, "ok")
    assert.equal(r.cloudHandoff, true)
    assert.ok(m.ranArgs(), "Devin foi executado após confirmação")
    const receipts = readAllReceipts(cwd)
    const rec = receipts.find((x) => x.intent === "delegate:devin")
    assert.ok(rec, "provenance registrou delegate:devin")
    assert.ok((rec.policy.rules || []).includes("cloud-handoff"), "recibo marca cloud-handoff")
  } finally {
    Object.defineProperty(process.stdin, "isTTY", { value: realTTY, configurable: true })
    await rm(cwd, { recursive: true, force: true, maxRetries: 5 })
  }
})

test("delegate: --cloud-handoff só vale para devin (opencode recusa)", async () => {
  const { delegateCommand } = await imp("src/commands/delegate.js")
  const r = await delegateCommand(["opencode", "--task", "x", "--cloud-handoff", "--yes"], { cwd: "/x", exec: () => Buffer.from("") })
  // erro claro; não retorna resultado de execução
  assert.equal(r, undefined)
})
