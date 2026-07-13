import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src/skills/visual-gate.js"))}?t=${Date.now()}`)

// Driver fake: devolve a observação declarada (screenshot escrito no disco quando pedido).
function fakeDriver(obs, { writeShot = true } = {}) {
  return {
    async observe(url, { screenshotPath } = {}) {
      if (writeShot && screenshotPath) {
        await mkdir(path.dirname(screenshotPath), { recursive: true })
        await writeFile(screenshotPath, "PNGDATA")
      }
      return { screenshotPath: screenshotPath || null, console: [], network: [], a11y: { checked: true, violations: [] }, ...obs }
    },
  }
}

test("app com erro 500 → falha por REDE (motivo distinto)", async () => {
  const { runVisualGate } = await imp()
  const root = await mkdtemp(path.join(tmpdir(), "gstack-vq-"))
  try {
    const driver = fakeDriver({ network: [{ url: "http://x/api", status: 500 }] })
    const r = await runVisualGate({ root, runId: "r1", url: "http://x", uiChanged: true, driver })
    assert.equal(r.status, "failed")
    assert.ok(r.problems.some((p) => />= 400/.test(p)), `esperava falha de rede: ${r.problems}`)
    assert.ok(!r.problems.some((p) => /acessibilidade/.test(p)), "não deve falhar por a11y")
    assert.equal(r.lenses.engineering.ok, false, "lente de engenharia pega o 5xx")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("violação a11y plantada → falha por A11Y (motivo distinto)", async () => {
  const { runVisualGate } = await imp()
  const root = await mkdtemp(path.join(tmpdir(), "gstack-vq-"))
  try {
    const driver = fakeDriver({ a11y: { checked: true, violations: [{ id: "color-contrast", impact: "serious", nodes: [{}] }] } })
    const r = await runVisualGate({ root, runId: "r2", url: "http://x", uiChanged: true, driver })
    assert.equal(r.status, "failed")
    assert.ok(r.problems.some((p) => /acessibilidade/.test(p)), `esperava falha de a11y: ${r.problems}`)
    assert.ok(!r.problems.some((p) => /400|console/.test(p)), "só a11y falha")
    assert.equal(r.lenses.product.ok, false, "lente de produto pega a11y séria")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("screenshot DECLARADO mas ausente no disco → falha por EVIDÊNCIA (não confia no path)", async () => {
  const { runVisualGate } = await imp()
  const root = await mkdtemp(path.join(tmpdir(), "gstack-vq-"))
  try {
    // driver declara o path mas NÃO escreve o arquivo (writeShot:false)
    const driver = fakeDriver({}, { writeShot: false })
    const r = await runVisualGate({ root, runId: "r3", url: "http://x", uiChanged: true, driver })
    assert.equal(r.status, "failed")
    assert.ok(r.problems.some((p) => /evidência inválida/.test(p)), `esperava falha de evidência: ${r.problems}`)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("evidência adulterada: expectedHash divergente → falha por hash", async () => {
  const { evaluateVisualGate, verifyScreenshotEvidence } = await imp()
  const root = await mkdtemp(path.join(tmpdir(), "gstack-vq-"))
  try {
    const shot = path.join(root, "s.png")
    await writeFile(shot, "REAL")
    const verified = verifyScreenshotEvidence({ screenshotPath: shot, expectedHash: "sha256:deadbeef", console: [], network: [], a11y: { checked: true, violations: [] } })
    const r = evaluateVisualGate({ uiChanged: true, observation: verified })
    assert.equal(r.status, "failed")
    assert.ok(r.problems.some((p) => /adulterada|hash/.test(p)), `esperava falha de hash: ${r.problems}`)
    assert.ok(verified.screenshotHash.startsWith("sha256:"), "hash real computado do disco")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("observação limpa → validated, com hash de evidência e a11yChecked", async () => {
  const { runVisualGate } = await imp()
  const root = await mkdtemp(path.join(tmpdir(), "gstack-vq-"))
  try {
    const driver = fakeDriver({})
    const r = await runVisualGate({ root, runId: "ok", url: "http://x", uiChanged: true, driver })
    assert.equal(r.status, "validated")
    assert.equal(r.problems.length, 0)
    assert.ok(r.screenshotHash && r.screenshotHash.startsWith("sha256:"), "evidência com hash no bundle")
    assert.equal(r.a11yChecked, true)
    for (const lens of ["qa", "engineering", "security", "product"]) assert.equal(r.lenses[lens].ok, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("a11y NÃO é mais hardcoded: probe ausente → checked:false (honesto, não 'limpo')", async () => {
  const { defaultA11yProbe } = await imp()
  // page sem evaluate e sem axe-core → checked:false (não finge zero violações)
  const res = await defaultA11yProbe({})
  assert.equal(res.checked, false, "sem axe-core, a11y é NÃO-verificada, não 'limpa'")
  assert.deepEqual(res.violations, [])
})
