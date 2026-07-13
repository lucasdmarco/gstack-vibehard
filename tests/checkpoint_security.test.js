import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { readFileSync, writeFileSync, symlinkSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// ── Guardas puras ────────────────────────────────────────────────────────────────
test("validCheckpointId: rejeita traversal e estranhos, aceita slug", async () => {
  const { validCheckpointId } = await imp("src/skills/checkpoint-guard.js")
  for (const bad of ["..", ".", "../x", "a/b", "a\\b", "", "x".repeat(65)]) assert.equal(validCheckpointId(bad), false, bad)
  for (const ok of ["run1", "abc-123", "R_2026.07"]) assert.equal(validCheckpointId(ok), true, ok)
})

test("isDeniedPath: .env*, .git/, chaves/credenciais nunca entram", async () => {
  const { isDeniedPath } = await imp("src/skills/checkpoint-guard.js")
  for (const d of [".env", ".env.local", "config/.env.production", ".git/config", "a/.git/x", ".ssh/id_rsa", ".aws/credentials", ".npmrc"]) {
    assert.equal(isDeniedPath(d), true, `deve negar ${d}`)
  }
  assert.equal(isDeniedPath("src/app.js"), false)
})

test("resolveWithin: rejeita absoluto e ../ ANTES de ler", async () => {
  const { resolveWithin } = await imp("src/skills/checkpoint-guard.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-cw-"))
  try {
    assert.equal(resolveWithin(root, "../../etc/passwd").ok, false)
    assert.equal(resolveWithin(root, path.join(root, "..", "x")).ok, false, "absoluto fora")
    assert.equal(resolveWithin(root, "src/ok.js").ok, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("resolveWithin: symlink/junction que escapa o root é rejeitado", async (t) => {
  const { resolveWithin } = await imp("src/skills/checkpoint-guard.js")
  const base = await mkdtemp(path.join(tmpdir(), "gstack-cw-"))
  try {
    const root = path.join(base, "root"); await mkdir(root)
    const outside = path.join(base, "outside"); await mkdir(outside)
    await writeFile(path.join(outside, "secret.txt"), "TOP")
    try { symlinkSync(outside, path.join(root, "link"), "junction") }
    catch { return t.skip("sem privilégio p/ symlink/junction") }
    const r = resolveWithin(root, path.join("link", "secret.txt"))
    assert.equal(r.ok, false, "caminho pela junction que aponta fora do root é rejeitado")
  } finally { await rm(base, { recursive: true, force: true }) }
})

// ── Integração: createCheckpoint / rollback ──────────────────────────────────────
test("createCheckpoint: runId traversal → rejeitado (invalid_run_id)", async () => {
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const r = createCheckpoint({ root: tmpdir(), runId: "../evil", files: [] })
  assert.equal(r.ok, false)
  assert.equal(r.status, "invalid_run_id")
})

test("createCheckpoint: arquivo .env → NEGADO (denylist), nada persistido", async () => {
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-cp-"))
  try {
    await writeFile(path.join(root, ".env"), "SECRET=1")
    const r = createCheckpoint({ root, runId: "r", files: [".env"] })
    assert.equal(r.ok, false)
    assert.equal(r.status, "denied")
    assert.ok(!existsSync(path.join(root, ".gstack", "runs", "r", "checkpoints")), "nada capturado")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("createCheckpoint: arquivo permitido mas com SEGREDO embutido → negado", async () => {
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-cp-"))
  try {
    await writeFile(path.join(root, "config.js"), 'const k = "pk_test_ABCDEF0123456789ABCDEF01"')
    const r = createCheckpoint({ root, runId: "r", files: ["config.js"] })
    assert.equal(r.ok, false, "conteúdo com segredo não entra em checkpoint")
    assert.equal(r.status, "denied")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("createCheckpoint: path traversal no file → negado antes de ler", async () => {
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-cp-"))
  try {
    const r = createCheckpoint({ root, runId: "r", files: ["../../escape.txt"] })
    assert.equal(r.ok, false)
    assert.equal(r.status, "denied")
    assert.match(r.reason, /traversal|fora do root/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("rollback: blob ADULTERADO → aborta (tamper_detected), working tree intacto", async () => {
  const { createCheckpoint, rollbackToCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-cp-"))
  try {
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "app.js"), "ORIGINAL")
    const c = createCheckpoint({ root, runId: "r", files: ["src/app.js"], green: true })
    assert.equal(c.ok, true)
    // adultera o blob salvo no store do checkpoint
    const blob = path.join(root, ".gstack", "runs", "r", "checkpoints", String(c.seq), "files", "src", "app.js")
    writeFileSync(blob, "TAMPERED")
    // muda o working tree e tenta rollback
    writeFileSync(path.join(root, "src", "app.js"), "WORKING")
    const rb = rollbackToCheckpoint({ root, runId: "r", seq: c.seq })
    assert.equal(rb.ok, false)
    assert.equal(rb.reason, "tamper_detected")
    assert.deepEqual(rb.restored, [], "nada restaurado quando há tamper")
    assert.equal(readFileSync(path.join(root, "src", "app.js"), "utf-8"), "WORKING", "working tree intacto (abort atômico)")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("rollback: blob íntegro → restaura o working tree ao ponto do checkpoint", async () => {
  const { createCheckpoint, rollbackToCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-cp-"))
  try {
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "app.js"), "V1")
    const c = createCheckpoint({ root, runId: "r", files: ["src/app.js"], green: true })
    writeFileSync(path.join(root, "src", "app.js"), "V2-quebrado")
    const rb = rollbackToCheckpoint({ root, runId: "r", seq: c.seq })
    assert.equal(rb.ok, true)
    assert.deepEqual(rb.restored, ["src/app.js"])
    assert.equal(readFileSync(path.join(root, "src", "app.js"), "utf-8"), "V1")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("rollback: seq externo inválido é rejeitado", async () => {
  const { rollbackToCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-cp-"))
  try {
    assert.equal(rollbackToCheckpoint({ root, runId: "r", seq: -1 }).ok, false)
    assert.equal(rollbackToCheckpoint({ root, runId: "r", seq: "1; rm" }).ok, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
