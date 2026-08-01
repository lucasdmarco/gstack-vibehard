import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD51 (fechamento do DOD.3) — `ready_with_warnings` tem DUAS causas em `pickStatus`
 * (`verify-runner.js`): ferramenta ausente OU drift do hook QG. A mensagem culpava
 * sempre a primeira e imprimia `toolMissing`, que no caso de drift é LISTA VAZIA:
 *
 *     "Pronto COM AVISOS — faltou ferramenta esperada: . Não é Zero-Trust completo."
 *
 * Achado real ao rodar `proof --profile full` no HEAD: o proof exige `status === "ready"`
 * estrito, então o drift bloqueava o RC por um motivo que a própria mensagem escondia —
 * o operador via uma lista vazia e nenhuma pista do hook global defasado.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "commands", "verify.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("drift do QG: a mensagem nomeia o hook divergente e as DUAS versões", async () => {
  const { warningCause } = await imp()
  const c = warningCause({
    toolMissing: [],
    qgDrift: true,
    qg: { version: "5.99.0", packagedVersion: "5.105.0", origin: "codex" },
  })
  assert.match(c, /5\.99\.0/, "diz a versão instalada")
  assert.match(c, /5\.105\.0/, "diz a versão empacotada")
  assert.match(c, /sync:qg/, "diz como corrigir")
  assert.doesNotMatch(c, /faltou ferramenta esperada/, "não culpa a causa errada")
})

test("CONTROLE NEGATIVO: com drift e toolMissing vazio, a mensagem NUNCA fica com lista vazia", async () => {
  const { warningCause } = await imp()
  const c = warningCause({ toolMissing: [], qgDrift: true, qg: {} })
  assert.doesNotMatch(c, /:\s*\.\s*$/, "sem 'causa: .' — o defeito original")
  assert.ok(c.length > 20, "a causa é dita por extenso")
})

test("ferramenta ausente continua sendo reportada como antes (nada regrediu)", async () => {
  const { warningCause } = await imp()
  const c = warningCause({ toolMissing: ["fallow", "graphify"], qgDrift: false })
  assert.match(c, /faltou ferramenta esperada: fallow, graphify/)
})

test("as duas causas juntas aparecem JUNTAS — uma não esconde a outra", async () => {
  const { warningCause } = await imp()
  const c = warningCause({
    toolMissing: ["fallow"],
    qgDrift: true,
    qg: { version: "1.0.0", packagedVersion: "2.0.0", origin: "codex" },
  })
  assert.match(c, /fallow/)
  assert.match(c, /hook QG divergente/)
})

test("causa desconhecida é DECLARADA, nunca silenciada nem inventada", async () => {
  const { warningCause } = await imp()
  const c = warningCause({ toolMissing: [], qgDrift: false })
  assert.match(c, /sem causa identificada/, "um motivo novo de warning não pode virar mensagem vazia")
})
