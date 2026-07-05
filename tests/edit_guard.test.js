import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "tools", "edit-guard.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

const FILE = "line1\nline2\nline3\nline4\nline5\n"

test("anchorHash: determinístico e estável a CRLF", async () => {
  const { anchorHash } = await imp()
  assert.equal(anchorHash("a\nb"), anchorHash("a\r\nb"), "CRLF normalizado")
  assert.match(anchorHash("x"), /^[0-9a-f]{12}$/)
  assert.notEqual(anchorHash("a"), anchorHash("b"))
})

test("excerpt + makeAnchor: captura o trecho por linhas (1-indexed inclusivo)", async () => {
  const { excerpt, makeAnchor } = await imp()
  assert.equal(excerpt(FILE, 2, 3), "line2\nline3")
  const a = makeAnchor(FILE, 2, 3)
  assert.equal(a.lineStart, 2)
  assert.equal(a.lineEnd, 3)
  assert.match(a.hash, /^[0-9a-f]{12}$/)
})

test("validateAnchor: bate quando inalterado, stale quando o trecho muda", async () => {
  const { makeAnchor, validateAnchor } = await imp()
  const anchor = makeAnchor(FILE, 2, 3)
  assert.equal(validateAnchor(FILE, anchor).ok, true, "inalterado → válido")

  const changed = "line1\nlineX\nline3\nline4\nline5\n"
  const v = validateAnchor(changed, anchor)
  assert.equal(v.ok, false)
  assert.equal(v.stale, true)
  assert.match(v.reason, /releia|mudou/i)
  assert.equal(v.expected, anchor.hash)
  assert.notEqual(v.actual, anchor.hash)

  // âncora inválida → stale recuperável
  assert.equal(validateAnchor(FILE, null).stale, true)
})

test("guardedEdit: aplica se bate, aborta RECUPERÁVEL se stale; registra provenance", async () => {
  const { makeAnchor, guardedEdit } = await imp()
  const anchor = makeAnchor(FILE, 2, 3)
  const events = []
  const record = (ev) => events.push(ev)

  let applied = 0
  const okRes = guardedEdit({ currentContent: FILE, anchor, apply: () => { applied += 1; return "done" }, record })
  assert.equal(okRes.applied, true)
  assert.equal(okRes.result, "done")
  assert.equal(applied, 1)
  assert.equal(events.at(-1).decision, "allow")

  const staleRes = guardedEdit({ currentContent: "x\ny\nz\n", anchor, apply: () => { applied += 1 }, record })
  assert.equal(staleRes.applied, false)
  assert.equal(staleRes.stale, true)
  assert.equal(staleRes.recoverable, true)
  assert.equal(applied, 1, "apply NÃO roda quando stale")
  assert.equal(events.at(-1).decision, "block")
})

test("provenanceRecorder: grava recibo no provenance do projeto (best-effort)", async () => {
  const { makeAnchor, guardedEdit, provenanceRecorder } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-eg-"))
  try {
    const rec = provenanceRecorder(cwd, "run-eg-1")
    guardedEdit({ currentContent: FILE, anchor: makeAnchor(FILE, 1, 1), apply: () => "x", record: rec })
    assert.ok(existsSync(path.join(cwd, ".gstack", "provenance", "actions.jsonl")), "provenance gravado")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("CLI tools edit-guard: anchor então check --json (stale → exitCode 1)", async () => {
  const toolsMod = path.join(repoRoot, "src", "commands", "tools.js")
  const { toolsCommand } = await import(`${pathToFileURL(toolsMod)}?t=${Date.now()}`)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-eg-"))
  const capture = () => {
    const orig = process.stdout.write.bind(process.stdout)
    let buf = ""
    process.stdout.write = (s) => { buf += String(s); return true }
    return { restore: () => { process.stdout.write = orig }, get: () => buf }
  }
  try {
    await writeFile(path.join(cwd, "f.txt"), FILE)
    let cap = capture()
    try { await toolsCommand(["edit-guard", "anchor", "f.txt", "2", "3", "--json"], { cwd }) } finally { cap.restore() }
    const anchor = JSON.parse(cap.get().trim())
    assert.match(anchor.hash, /^[0-9a-f]{12}$/)

    // check com hash correto → ok
    process.exitCode = 0
    cap = capture()
    try { await toolsCommand(["edit-guard", "check", "f.txt", "2", "3", anchor.hash, "--json"], { cwd }) } finally { cap.restore() }
    assert.equal(JSON.parse(cap.get().trim()).ok, true)
    assert.notEqual(process.exitCode, 1)

    // muda o arquivo → check stale → exitCode 1
    await writeFile(path.join(cwd, "f.txt"), "line1\nCHANGED\nline3\nline4\nline5\n")
    cap = capture()
    try { await toolsCommand(["edit-guard", "check", "f.txt", "2", "3", anchor.hash, "--json"], { cwd }) } finally { cap.restore() }
    assert.equal(JSON.parse(cap.get().trim()).stale, true)
    assert.equal(process.exitCode, 1)
    process.exitCode = 0
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
