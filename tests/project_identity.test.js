import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync, readFileSync, renameSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "project", "identity.js")

async function load() {
  return import(`${pathToFileURL(mod)}?t=${Date.now()}`)
}

test("writeProjectMarker grava project.json com schema canônico e root resolvido", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-id-"))
  try {
    const { writeProjectMarker, PROJECT_MARKER_SCHEMA, hasValidMarker } = await load()
    const m = writeProjectMarker(tmp, { mode: "full", createdBy: "test" })
    assert.equal(m.schemaVersion, PROJECT_MARKER_SCHEMA)
    assert.equal(m.mode, "full")
    assert.equal(m.activated, true)
    assert.ok(m.projectId, "gera projectId")
    const onDisk = JSON.parse(readFileSync(path.join(tmp, ".gstack", "project.json"), "utf8"))
    assert.equal(onDisk.schemaVersion, PROJECT_MARKER_SCHEMA)
    assert.ok(hasValidMarker(tmp), "marcador recém-escrito é válido")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("hasValidMarker: bare .gstack (sem project.json) é INVÁLIDO — o defeito P0.3", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-id-"))
  try {
    const { hasValidMarker } = await load()
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    assert.equal(hasValidMarker(tmp), false, "`.gstack/` vazio não ativa (anti-vazamento)")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("hasValidMarker: root divergente (pasta movida) invalida o marcador", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-id-"))
  try {
    const { writeProjectMarker, hasValidMarker } = await load()
    const proj = path.join(tmp, "proj")
    await mkdir(proj, { recursive: true })
    writeProjectMarker(proj)
    const moved = path.join(tmp, "movido")
    renameSync(proj, moved)  // marcador aponta pro root antigo
    assert.equal(hasValidMarker(moved), false, "root do marcador != diretório → inerte")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("writeProjectMarker é idempotente: preserva projectId ao reescrever", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-id-"))
  try {
    const { writeProjectMarker } = await load()
    const a = writeProjectMarker(tmp, { mode: "lite" })
    const b = writeProjectMarker(tmp, { mode: "full" })
    assert.equal(b.projectId, a.projectId, "mesmo projectId")
    assert.equal(b.mode, "full", "atualiza mode")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("schemaVersion errado não é aceito por hasValidMarker", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-id-"))
  try {
    const { hasValidMarker } = await load()
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    await writeFile(
      path.join(tmp, ".gstack", "project.json"),
      JSON.stringify({ schemaVersion: "gstack.project.v0", root: tmp }),
    )
    assert.equal(hasValidMarker(tmp), false, "schema desconhecido = inválido")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

// NÃO É ENFEITE: o marcador escrito pelo lado JS (create/enable) tem que ATIVAR o hook
// Python REAL (find_gstack_root). Prova cross-language do contrato do formato.
test("marcador JS ativa o find_gstack_root do Python (contrato cross-language)", async (t) => {
  const py = spawnSync("python", ["--version"], { encoding: "utf8" })
  if (py.status !== 0) return t.skip("python indisponível")
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-xl-"))
  try {
    const { writeProjectMarker } = await load()
    const proj = path.join(tmp, "proj")
    await mkdir(path.join(proj, "src"), { recursive: true })
    writeProjectMarker(proj, { mode: "full", createdBy: "test:xlang" })
    const hooks = path.join(repoRoot, "hooks", "hooks")
    const code = [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(hooks)})`,
      "from _paths import find_gstack_root",
      `r = find_gstack_root(${JSON.stringify(path.join(proj, "src"))})`,
      "print(json.dumps(str(r) if r else None))",
    ].join("\n")
    const out = spawnSync("python", ["-c", code], { encoding: "utf8" })
    assert.equal(out.status, 0, out.stderr)
    const resolved = JSON.parse(out.stdout.trim())
    assert.ok(resolved, "Python DEVE ativar (achou o root) a partir do marcador JS")
    // ambos resolvem canônico: comparar por realpath evita divergência de casing/8.3
    assert.equal(
      spawnSync("python", ["-c", `import os;print(os.path.realpath(${JSON.stringify(proj)}))`], { encoding: "utf8" }).stdout.trim(),
      resolved,
      "root ativado == diretório do projeto",
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
