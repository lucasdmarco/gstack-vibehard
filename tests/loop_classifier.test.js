import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("loop-classifier: escolhe o loop certo por keywords (com reason e confidence)", async () => {
  const { classifyLoop } = await imp("src/project-plan/loop-classifier.js")
  assert.equal(classifyLoop({ task: "corrigir erro 500 no login" }).loopPattern, "runtime-debugging")
  assert.equal(classifyLoop({ task: "teste de regressão falhando no parser" }).loopPattern, "test-driven")
  assert.equal(classifyLoop({ task: "ajustar tipos do TypeScript e build" }).loopPattern, "compiler-driven")
  assert.equal(classifyLoop({ task: "aplicar comentários do review do PR" }).loopPattern, "review-driven")
  assert.equal(classifyLoop({ task: "melhorar a landing page e o layout responsivo" }).loopPattern, "product-iteration")
  const r = classifyLoop({ task: "corrigir erro 500" })
  assert.ok(r.confidence > 0 && r.reason.length > 0)
})

test("loop-classifier: sinais explícitos decidem; sem sinais → test-driven", async () => {
  const { classifyLoop } = await imp("src/project-plan/loop-classifier.js")
  assert.equal(classifyLoop({ task: "algo genérico", hasRuntimeError: true }).loopPattern, "runtime-debugging")
  const none = classifyLoop({ task: "fazer uma coisa qualquer zzz" })
  assert.equal(none.loopPattern, "test-driven")
  assert.ok(none.confidence <= 0.3)
})
