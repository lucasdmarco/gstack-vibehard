import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("stripBom: remove o BOM UTF-8 inicial; no-op em texto limpo", async () => {
  const { stripBom, readJsonFile } = await imp("src/util/json.js")
  assert.equal(stripBom("﻿{}"), "{}", "remove o BOM")
  assert.equal(stripBom("{}"), "{}", "no-op sem BOM")
  assert.equal(stripBom("a﻿b"), "a﻿b", "só remove no INÍCIO")
  assert.equal(typeof readJsonFile, "function")
})

// ── BOM real no manifest (PowerShell 5.1 `Set-Content -Encoding utf8`) ──
test("loadRuntimeManifest: tolera runtime.json gravado COM BOM (Windows)", async () => {
  const { loadRuntimeManifest } = await imp("src/runtime/manifest.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-bom-"))
  try {
    await mkdir(path.join(dir, ".gstack"), { recursive: true })
    const json = JSON.stringify({ schemaVersion: 2, services: [{ name: "web", command: ["node", "x.js"] }] })
    // grava COM BOM (﻿) — igual ao Set-Content -Encoding utf8 do PS 5.1
    await writeFile(path.join(dir, ".gstack", "runtime.json"), "﻿" + json, "utf-8")
    const m = loadRuntimeManifest(dir)
    assert.ok(m, "manifest com BOM é lido (não retorna null)")
    assert.equal(m.schemaVersion, 2)
    assert.equal(m.services[0].name, "web")
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})
