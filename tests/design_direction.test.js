import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("proposeDesignDirections: catálogo + custom + opt-out, sempre as mesmas 6 opções (determinístico)", async () => {
  const { proposeDesignDirections } = await imp("src/project-plan/design-direction.js")
  const opts = proposeDesignDirections()
  assert.equal(opts.length, 6)
  assert.ok(opts.some((o) => o.value === "custom"))
  assert.ok(opts.some((o) => o.value === "none"))
})

test("tokensForDirection: direção do catálogo tem colors E typography não-vazios (verificável)", async () => {
  const { DESIGN_DIRECTION_CATALOG, tokensForDirection } = await imp("src/project-plan/design-direction.js")
  for (const d of DESIGN_DIRECTION_CATALOG) {
    const t = tokensForDirection(d.value)
    assert.ok(t.colors && Object.keys(t.colors).length > 0, d.value)
    assert.ok(t.typography && Object.keys(t.typography).length > 0, d.value)
  }
})

test("tokensForDirection: custom/none/desconhecido -> null (nada a verificar)", async () => {
  const { tokensForDirection } = await imp("src/project-plan/design-direction.js")
  assert.equal(tokensForDirection("custom"), null)
  assert.equal(tokensForDirection("none"), null)
  assert.equal(tokensForDirection("nao-existe"), null)
})

test("isDirectionResolved: catálogo/custom/none são resolvidos; string vazia ou lixo não", async () => {
  const { isDirectionResolved, DESIGN_DIRECTION_CATALOG } = await imp("src/project-plan/design-direction.js")
  assert.equal(isDirectionResolved(DESIGN_DIRECTION_CATALOG[0].value), true)
  assert.equal(isDirectionResolved("custom"), true)
  assert.equal(isDirectionResolved("none"), true)
  assert.equal(isDirectionResolved(""), false)
  assert.equal(isDirectionResolved(undefined), false)
  assert.equal(isDirectionResolved("cor-aleatoria-inventada"), false)
})
