import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.9.1 — decisão do Runtime Manifest V3 (§51.9 ações 1 e 2).
 *
 * Estado verificado antes de decidir: o V3 era **dormente**. Schema, migração
 * (`migrateManifestToV3`) e validação (`validateRuntimeManifestV3`) existiam e
 * eram testados, mas o único lugar do repo que os chamava eram os testes —
 * nenhum consumidor em `src/`. O `rc-checklist-prd45` já marcava o P1.3 como
 * `partial` por isso.
 *
 * DEFEITO REAL encontrado no caminho (§51.9 ação 2, "não permitir downgrade
 * silencioso de V3 para V2"): `loadV2Preferred` fazia
 * `m.schemaVersion === 2 ? m : buildRuntimeManifest(...)`. Um arquivo v3 caía no
 * `else` e voltava RECONSTRUÍDO como v2, descartando em silêncio `workflows`,
 * `postMerge`, `deploy` e `health`. Verificado rodando o loader: `schemaVersion`
 * voltava 2 e os quatro campos vinham `undefined`.
 *
 * DECISÃO: **promover** (a opção "migração V2→V3, rollback e compatibilidade"
 * do PRD). Promovido = carrega, valida e roda nas duas versões. NÃO significa
 * que os campos de projeto do v3 executem — eles são declarados e reportados
 * como `declaredNotExecuted`, porque o supervisor consome só `services`.
 * Alegar execução de `workflows`/`deploy` seria claim sem prova.
 */

const V3 = Object.freeze({
  schemaVersion: 3,
  services: [{ name: "web", command: ["node", "server.js"] }],
  workflows: [{ name: "build", steps: ["npm run build"] }],
  postMerge: { command: ["npm", "ci"] },
  deploy: { target: "static" },
  health: { type: "http", path: "/health", timeoutSeconds: 60, intervalSeconds: 5 },
})
const V2 = Object.freeze({ schemaVersion: 2, services: [{ name: "web", command: ["node", "server.js"] }] })
const io = (m) => ({ exists: () => true, readJson: () => m })

// O controle negativo do defeito: era exatamente isto que falhava antes.
test("DEFEITO CORRIGIDO: manifest v3 em disco carrega COMO v3, sem perder campo nenhum", async () => {
  const { loadRuntimeManifest } = await imp("src/runtime/manifest.js")
  const got = loadRuntimeManifest("/fake", io(V3))
  assert.equal(got.schemaVersion, 3, "antes voltava 2 — downgrade silencioso")
  assert.deepEqual(got.workflows, V3.workflows)
  assert.deepEqual(got.postMerge, V3.postMerge)
  assert.deepEqual(got.deploy, V3.deploy)
  assert.deepEqual(got.health, V3.health)
})

test("CONTROLE NEGATIVO: nenhum campo de projeto do v3 pode voltar `undefined` do loader", async () => {
  const { loadRuntimeManifest, V3_PROJECT_FIELDS } = await imp("src/runtime/manifest.js")
  const got = loadRuntimeManifest("/fake", io(V3))
  for (const f of V3_PROJECT_FIELDS) {
    assert.notEqual(got[f], undefined, `campo ${f} sumiu no carregamento — é o bug original`)
  }
})

test("COMPATIBILIDADE: v2 continua carregando exatamente como antes", async () => {
  const { loadRuntimeManifest } = await imp("src/runtime/manifest.js")
  const got = loadRuntimeManifest("/fake", io(V2))
  assert.equal(got.schemaVersion, 2)
  assert.deepEqual(got.services, V2.services)
})

test("manifest SEM schemaVersion conhecido continua sendo normalizado para v2 (legado)", async () => {
  const { loadRuntimeManifest } = await imp("src/runtime/manifest.js")
  const got = loadRuntimeManifest("/fake", io({ services: [{ name: "api", command: ["node", "a.js"] }] }))
  assert.equal(got.schemaVersion, 2, "normalização de legado é intencional e não perde nada que exista")
})

// Validação despacha por versão.
test("validateManifestForVersion: v3 válido passa (antes era reprovado por 'schemaVersion deve ser 2')", async () => {
  const { validateManifestForVersion } = await imp("src/runtime/manifest.js")
  const v = validateManifestForVersion(V3)
  assert.equal(v.valid, true, v.errors?.join(", "))
  assert.equal(v.schemaVersion, 3)
})

test("validateManifestForVersion: v2 válido segue passando", async () => {
  const { validateManifestForVersion } = await imp("src/runtime/manifest.js")
  assert.equal(validateManifestForVersion(V2).valid, true)
})

test("CONTROLE NEGATIVO: v3 com campo de projeto do TIPO errado é reprovado", async () => {
  const { validateManifestForVersion } = await imp("src/runtime/manifest.js")
  const v = validateManifestForVersion({ ...V3, workflows: "não é array" })
  assert.equal(v.valid, false)
  assert.ok(v.errors.some((e) => /workflows/.test(e)))
})

test("CONTROLE NEGATIVO: v3 com serviço inválido é reprovado pela MESMA checagem do v2", async () => {
  const { validateManifestForVersion } = await imp("src/runtime/manifest.js")
  const v = validateManifestForVersion({ ...V3, services: [{ name: "web", command: "npm run dev" }] })
  assert.equal(v.valid, false)
  assert.ok(v.errors.some((e) => /command deve ser array/.test(e)), "sem shell string, nem no v3")
})

test("CONTROLE NEGATIVO: manifest ausente/inválido não vira 'válido' por omissão", async () => {
  const { validateManifestForVersion } = await imp("src/runtime/manifest.js")
  assert.equal(validateManifestForVersion(null).valid, false)
  assert.equal(validateManifestForVersion("texto").valid, false)
  assert.equal(validateManifestForVersion(null).schemaVersion, null)
})

// Escopo honesto: o que é declarado vs. o que roda.
test("ESCOPO HONESTO: v3 declara workflows/deploy/health mas só `services` executa", async () => {
  const { manifestExecutionScope } = await imp("src/runtime/manifest.js")
  const s = manifestExecutionScope(V3)
  assert.deepEqual(s.executed, ["services"])
  assert.deepEqual(s.declaredNotExecuted, ["workflows", "postMerge", "deploy", "health"])
  assert.match(s.note, /executa apenas/)
})

test("v2 não declara nada além do que executa (nada a avisar)", async () => {
  const { manifestExecutionScope } = await imp("src/runtime/manifest.js")
  const s = manifestExecutionScope(V2)
  assert.deepEqual(s.declaredNotExecuted, [])
  assert.equal(s.note, null)
})

test("campo de projeto VAZIO não conta como declarado (não inventa aviso)", async () => {
  const { manifestExecutionScope } = await imp("src/runtime/manifest.js")
  const s = manifestExecutionScope({ schemaVersion: 3, services: V2.services, workflows: [], postMerge: null, deploy: null, health: null })
  assert.deepEqual(s.declaredNotExecuted, [])
})

// Rollback explícito (exigência do §51.9 ação 1).
test("ROLLBACK: downgradeManifestToV2 é EXPLÍCITO e lista o que foi perdido", async () => {
  const { downgradeManifestToV2 } = await imp("src/runtime/manifest.js")
  const r = downgradeManifestToV2(V3)
  assert.equal(r.manifest.schemaVersion, 2)
  assert.deepEqual(r.manifest.services.map((s) => s.name), ["web"])
  assert.deepEqual(r.dropped, ["workflows", "postMerge", "deploy", "health"], "o downgrade DIZ o que descarta")
})

test("ROLLBACK de um v2 não descarta nada", async () => {
  const { downgradeManifestToV2 } = await imp("src/runtime/manifest.js")
  assert.deepEqual(downgradeManifestToV2(V2).dropped, [])
})

// Migração ida-e-volta.
// `buildRuntimeManifest` NORMALIZA serviços (preenche cwd/dependsOn/port/
// health/restart/secretRefs). A invariante correta é ESTABILIDADE do round-trip
// contra a forma normalizada, não igualdade com o literal cru.
test("migração v2→v3→v2 preserva os serviços (round-trip estável, sem perda)", async () => {
  const { migrateManifestToV3, downgradeManifestToV2, buildRuntimeManifest } = await imp("src/runtime/manifest.js")
  const normalizado = buildRuntimeManifest({ services: V2.services }).services
  const up = migrateManifestToV3(V2)
  assert.equal(up.schemaVersion, 3)
  const back = downgradeManifestToV2(up)
  assert.deepEqual(back.manifest.services, normalizado)
  // Segunda volta não muda mais nada (idempotente).
  assert.deepEqual(downgradeManifestToV2(migrateManifestToV3(back.manifest)).manifest.services, normalizado)
})

// Wiring REAL: o `dev` deixou de ser cego ao v3.
test("WIRING REAL: runtime-supervisor valida por VERSÃO e anuncia o escopo (não mais só v2)", async () => {
  const src = readFileSync(path.join(repoRoot, "src", "commands", "runtime-supervisor.js"), "utf-8")
  assert.match(src, /validateManifestForVersion/, "o dev passou a despachar por versão")
  assert.match(src, /announceExecutionScope/, "e a dizer o que NÃO executa")
  assert.ok(!/validateRuntimeManifest\(/.test(src), "não sobrou chamada v2-only no caminho do dev")
})

test("V3 deixou de ser dormente: existe consumidor REAL em src/, não só em tests/", async () => {
  const supervisor = readFileSync(path.join(repoRoot, "src", "commands", "runtime-supervisor.js"), "utf-8")
  const manifest = readFileSync(path.join(repoRoot, "src", "runtime", "manifest.js"), "utf-8")
  assert.match(supervisor, /manifestExecutionScope/)
  assert.match(manifest, /RUNTIME_MANIFEST_SCHEMA_V3\) return m/, "o loader reconhece v3 explicitamente")
})
