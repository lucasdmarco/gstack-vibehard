import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

/**
 * PRD49 S49.2A — proveniência do vendor snapshot real do Impeccable. Prova que
 * `upstream-map.md`/`UPSTREAM.json` batem com o que está REALMENTE em disco — nenhum
 * arquivo vendorizado sem hash correspondente, nenhuma alegação de commit/licença sem
 * o arquivo real presente.
 */
const repoRoot = path.resolve(import.meta.dirname, "..")
const vendorDir = path.join(repoRoot, "src", "vendor", "impeccable")
const sha256 = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex")

test("UPSTREAM.json: schema real — commit auditado, licença Apache-2.0, mirroredByThisSession real", () => {
  const up = JSON.parse(readFileSync(path.join(vendorDir, "UPSTREAM.json"), "utf-8"))
  assert.equal(up.repo, "https://github.com/pbakaus/impeccable")
  assert.match(up.auditedCommit, /^[0-9a-f]{40}$/, "commit é um SHA git real de 40 hex")
  assert.equal(up.license, "Apache-2.0")
  assert.equal(up.mirroredByThisSession, true, "esta sprint fez um mirror REAL, não só citou o PRD")
})

test("LICENSE: arquivo Apache-2.0 real presente, hash bate com UPSTREAM.json", () => {
  const licensePath = path.join(vendorDir, "LICENSE")
  assert.ok(existsSync(licensePath))
  const content = readFileSync(licensePath, "utf-8")
  assert.match(content, /Apache License/)
  assert.match(content, /Copyright 2025 Paul Bakaus/)
  const up = JSON.parse(readFileSync(path.join(vendorDir, "UPSTREAM.json"), "utf-8"))
  assert.equal(sha256(readFileSync(licensePath)), up.licenseSha256)
})

test("NOTICE: existe e cita o commit auditado + a proveniência", () => {
  const content = readFileSync(path.join(vendorDir, "NOTICE"), "utf-8")
  assert.match(content, /pbakaus\/impeccable/)
  assert.match(content, /4d849eb75f216109ea7053ed21530a11fafcc786/)
  assert.match(content, /Apache License,\s+Version 2\.0/)
})

test("upstream-map.md: TODO arquivo listado como vendorizado existe de verdade em disco (sem enfeite)", () => {
  const map = readFileSync(path.join(vendorDir, "upstream-map.md"), "utf-8")
  // extrai as linhas da tabela "Escopo desta sprint" — cada `path GStack` precisa existir.
  const rows = [...map.matchAll(/\| `([^`]+)` \| `([^`]+)` \| `sha256:([0-9a-f]{64})` \| `(unchanged|modified|rewritten)` \|/g)]
  assert.ok(rows.length >= 1, "pelo menos 1 arquivo real vendorizado nesta sprint")
  for (const [, gstackPath, , recordedSha] of rows) {
    const full = path.join(vendorDir, gstackPath)
    assert.ok(existsSync(full), `${gstackPath} está no mapa mas não existe em disco`)
    assert.equal(sha256(readFileSync(full)).replace("sha256:", ""), recordedSha, `${gstackPath}: hash em disco bate com o mapa`)
  }
})

test("color.mjs vendorizado: nenhuma API exclusiva de Node 22 — roda no floor GStack (>=18)", () => {
  const content = readFileSync(path.join(vendorDir, "shared", "color.mjs"), "utf-8")
  // sinais grosseiros de API recente (Array.prototype.group, structuredClone sem polyfill, etc.)
  // — o arquivo real só usa regex/Math/String, então isso deve passar limpo.
  assert.ok(!/\bstructuredClone\(/.test(content))
  assert.ok(!/\.group\(/.test(content))
})

test("sensitive/generated path filters: nenhum arquivo vendorizado é .env*, config de harness ou instalador", () => {
  const map = readFileSync(path.join(vendorDir, "upstream-map.md"), "utf-8")
  assert.ok(!/\.env/.test(map))
  assert.ok(!map.includes("cli/main.mjs` |") || map.includes("excluído por design"), "CLI upstream, se citado, está marcado como excluído por design")
})
