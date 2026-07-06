import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { stripBom } from "../src/util/json.js"

const repoRoot = path.resolve(import.meta.dirname, "..")

// JSONC leniente: remove // e /* */ para o parse (o config é .jsonc).
function readJsonc(file) {
  const raw = stripBom(readFileSync(file, "utf-8"))
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "")
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, "$1")
  return JSON.parse(noLine)
}

test("fallow gate: .fallowrc.jsonc referencia as 3 baselines (gate por regressão)", () => {
  const cfgPath = path.join(repoRoot, ".fallowrc.jsonc")
  assert.ok(existsSync(cfgPath), ".fallowrc.jsonc presente")
  const cfg = readJsonc(cfgPath)
  assert.ok(cfg.audit, "seção audit presente")
  assert.equal(cfg.audit.deadCodeBaseline, ".fallow-baselines/dead-code.json")
  assert.equal(cfg.audit.dupesBaseline, ".fallow-baselines/dupes.json")
  assert.equal(cfg.audit.healthBaseline, ".fallow-baselines/health.json")
})

test("fallow gate: os 3 arquivos de baseline existem e são JSON válido", () => {
  for (const name of ["dead-code.json", "dupes.json", "health.json"]) {
    const p = path.join(repoRoot, ".fallow-baselines", name)
    assert.ok(existsSync(p), `${name} presente`)
    const parsed = JSON.parse(stripBom(readFileSync(p, "utf-8")))
    assert.equal(typeof parsed, "object", `${name} é JSON objeto`)
  }
})
