import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.4.5 — registry de efeitos por operação (schema mínimo do §51.4).
 * Escopo honesto: cobre as operações investigadas de verdade em S51.4.1-3
 * (`plan run`, `visual hooks install`, `research skills audit --repo`) + um
 * punhado de operações bem conhecidas — não afirma cobertura dos ~49
 * comandos do DISPATCH.
 */

test("OPERATION_REGISTRY: toda entrada usa só efeitos do vocabulário fechado", async () => {
  const { invalidEffects, OPERATION_REGISTRY } = await imp("src/meta/operation-registry.js")
  assert.ok(OPERATION_REGISTRY.length > 0)
  assert.deepEqual(invalidEffects(), [])
})

test("invalidEffects: CONTROLE NEGATIVO -- efeito fora do vocabulário é detectado", async () => {
  const { invalidEffects } = await imp("src/meta/operation-registry.js")
  const bad = [{ command: "x", subcommand: null, effects: ["delete_universe"], network: false, execution: true, requiresConsent: true, jsonSchema: null }]
  const found = invalidEffects(bad)
  assert.equal(found.length, 1)
  assert.deepEqual(found[0].bad, ["delete_universe"])
})

test("registry: 'visual hooks install' bate com o exemplo do próprio PRD51 §51.4 (schema mínimo)", async () => {
  const { OPERATION_REGISTRY } = await imp("src/meta/operation-registry.js")
  const entry = OPERATION_REGISTRY.find((e) => e.command === "visual" && e.subcommand === "hooks install")
  assert.deepEqual(entry.effects, ["write_project_config"])
  assert.equal(entry.network, false)
  assert.equal(entry.requiresConsent, true)
  assert.equal(entry.jsonSchema, "gstack.design-hook-projection.v1")
})

test("registry: 'research skills audit --repo' é rede real (achado do S51.4.3), requiresConsent true", async () => {
  const { OPERATION_REGISTRY } = await imp("src/meta/operation-registry.js")
  const entry = OPERATION_REGISTRY.find((e) => e.command === "research" && e.subcommand === "skills audit --repo")
  assert.equal(entry.network, true)
  assert.equal(entry.requiresConsent, true)
})

test("mutableOperationMisclassified: comando com efeito mutável e SEM classificação no firewall é achado real", async () => {
  const { mutableOperationMisclassified } = await imp("src/meta/operation-registry.js")
  const registry = [{ command: "comando-fantasma", subcommand: null, effects: ["execute"], network: false, execution: true, requiresConsent: true, jsonSchema: null }]
  const found = mutableOperationMisclassified(registry, () => "unknown")
  assert.equal(found.length, 1)
  assert.equal(found[0].command, "comando-fantasma")
})

test("mutableOperationMisclassified: registry REAL não tem nenhum comando fora do firewall (todos classificados)", async () => {
  const { mutableOperationMisclassified } = await imp("src/meta/operation-registry.js")
  assert.deepEqual(mutableOperationMisclassified(), [])
})

test("mutableOperationMisclassified: comando 'knowledge' com efeito mutável em subcomando NÃO é falso-positivo (research/visual escrevem .gstack/config, nunca fonte)", async () => {
  const { mutableOperationMisclassified } = await imp("src/meta/operation-registry.js")
  const { layerOf } = await imp("src/meta/command-layers.js")
  const registry = [{ command: "visual", subcommand: "hooks install", effects: ["write_project_config"], network: false, execution: true, requiresConsent: true, jsonSchema: null }]
  assert.equal(layerOf("visual"), "knowledge")
  assert.deepEqual(mutableOperationMisclassified(registry, layerOf), [], "visual classificado -> não é 'misclassified', mesmo escrevendo config")
})
