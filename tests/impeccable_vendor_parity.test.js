import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD49 S49.2A — paridade comportamental do primeiro módulo REAL vendorizado
 * (`shared/color.mjs`, byte-idêntico ao upstream pbakaus/impeccable no commit
 * `4d849eb75f216109ea7053ed21530a11fafcc786`). Prova que a função importada funciona de
 * verdade no Node 18 do GStack — não só "importa sem erro".
 */
const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = () => import(pathToFileURL(path.join(repoRoot, "src", "vendor", "impeccable", "shared", "color.mjs")).href)

test("contrastRatio: branco vs preto -> 21:1 (máximo WCAG possível)", async () => {
  const { contrastRatio } = await imp()
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 0, g: 0, b: 0 }
  assert.equal(Math.round(contrastRatio(white, black) * 100) / 100, 21)
})

test("relativeLuminance: branco=1, preto=0 (fórmula WCAG padrão)", async () => {
  const { relativeLuminance } = await imp()
  assert.equal(Math.round(relativeLuminance({ r: 255, g: 255, b: 255 }) * 1000) / 1000, 1)
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0)
})

test("isNeutralColor: cinza (sem chroma) -> true; vermelho saturado -> false", async () => {
  const { isNeutralColor } = await imp()
  assert.equal(isNeutralColor("rgb(128,128,128)"), true)
  assert.equal(isNeutralColor("rgb(255,0,0)"), false)
  assert.equal(isNeutralColor("transparent"), true)
})

test("parseRgb: parseia rgb()/rgba() reais, inclusive alpha", async () => {
  const { parseRgb } = await imp()
  assert.deepEqual(parseRgb("rgb(10, 20, 30)"), { r: 10, g: 20, b: 30, a: 1 })
  assert.deepEqual(parseRgb("rgba(10, 20, 30, 0.5)"), { r: 10, g: 20, b: 30, a: 0.5 })
  assert.equal(parseRgb("não é cor"), null)
})

test("getHue: vermelho=0°, verde=120°, azul=240° (roda de cor padrão)", async () => {
  const { getHue } = await imp()
  assert.equal(getHue({ r: 255, g: 0, b: 0 }), 0)
  assert.equal(getHue({ r: 0, g: 255, b: 0 }), 120)
  assert.equal(getHue({ r: 0, g: 0, b: 255 }), 240)
})

test("colorToHex: RGB -> hex de 6 dígitos, minúsculo", async () => {
  const { colorToHex } = await imp()
  assert.equal(colorToHex({ r: 255, g: 0, b: 0 }), "#ff0000")
  assert.equal(colorToHex({ r: 0, g: 0, b: 0 }), "#000000")
})

test("hasChroma: threshold real do upstream — spread de canal >= 30 tem chroma", async () => {
  const { hasChroma } = await imp()
  assert.equal(hasChroma({ r: 100, g: 100, b: 100 }), false, "sem spread, sem chroma")
  assert.equal(hasChroma({ r: 200, g: 50, b: 50 }), true, "spread grande, tem chroma")
})

test("parseGradientColors: extrai cores rgb() e hex de um background-image real", async () => {
  const { parseGradientColors } = await imp()
  const colors = parseGradientColors("linear-gradient(rgb(255,0,0), #00ff00)")
  assert.equal(colors.length, 2)
  assert.deepEqual(colors[0], { r: 255, g: 0, b: 0, a: 1 })
  assert.deepEqual(colors[1], { r: 0, g: 255, b: 0, a: 1 })
})
