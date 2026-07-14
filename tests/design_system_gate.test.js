import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mkProj = (prefix) => mkdtempSync(path.join(tmpdir(), prefix))
const writeGstack = (dir, file, obj) => {
  mkdirSync(path.join(dir, ".gstack"), { recursive: true })
  writeFileSync(path.join(dir, ".gstack", file), JSON.stringify(obj) + "\n")
}

// ── detecção de UI ─────────────────────────────────────────────────────────────
test("isUiWrite: tsx/css/components/pages/app contam; util .js e docs não", async () => {
  const { isUiWrite } = await imp("src/skills/design-system.js")
  for (const ui of ["src/App.tsx", "src/components/Button.tsx", "app/page.tsx", "pages/index.jsx", "styles/main.css", "ui.vue"])
    assert.equal(isUiWrite(ui), true, `${ui} deveria ser UI`)
  for (const non of ["src/lib/parse.js", "README.md", "scripts/build.mjs", "data.json"])
    assert.equal(isUiWrite(non), false, `${non} NÃO deveria ser UI`)
})

// ── resolução de status ────────────────────────────────────────────────────────
test("resolveDesignSystem: missing sem nada; bypassed com --design-system none", async () => {
  const { resolveDesignSystem } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-ds-a-")
  try {
    assert.equal(resolveDesignSystem({ root: dir }).status, "missing")
    assert.equal(resolveDesignSystem({ root: dir, bypass: "none" }).status, "bypassed")
    assert.equal(existsSync(path.join(dir, ".gstack", "design-system.json")), false, "bypass não escreve artefato")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("resolveDesignSystem: design-system.json presente tem precedência", async () => {
  const { resolveDesignSystem } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-ds-b-")
  try {
    writeGstack(dir, "design-system.json", { schemaVersion: "gstack.design-system.v1", status: "complete", engine: "shadcn" })
    const r = resolveDesignSystem({ root: dir })
    assert.equal(r.status, "complete"); assert.equal(r.source, "design-system.json"); assert.equal(r.engine, "shadcn")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("resolveDesignSystem: importa session_state legado → escreve design-system.json canônico", async () => {
  const { resolveDesignSystem } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-ds-c-")
  try {
    writeGstack(dir, "session_state.json", { asked_about_design_system: true, design_system_path: "design-system/" })
    const r = resolveDesignSystem({ root: dir })
    assert.equal(r.status, "complete"); assert.equal(r.source, "session_state.json"); assert.equal(r.imported, true)
    const canonical = path.join(dir, ".gstack", "design-system.json")
    assert.ok(existsSync(canonical), "artefato canônico foi criado")
    assert.equal(JSON.parse(readFileSync(canonical, "utf-8")).importedFrom, "session_state.json")
    // importLegacy:false NÃO escreve (dry-run)
    const dir2 = mkProj("gstack-ds-c2-")
    writeGstack(dir2, "session_state.json", { asked_about_design_system: true })
    assert.equal(resolveDesignSystem({ root: dir2, importLegacy: false }).status, "missing")
    assert.equal(existsSync(path.join(dir2, ".gstack", "design-system.json")), false)
    rmSync(dir2, { recursive: true, force: true })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("registerDesignSystem: grava artefato canônico E sincroniza session_state (hook coerente)", async () => {
  const { registerDesignSystem } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-ds-reg-")
  try {
    const r = registerDesignSystem({ root: dir, choice: "meu-ds/" })
    assert.equal(r.status, "complete"); assert.equal(r.path, "meu-ds/")
    const sess = JSON.parse(readFileSync(path.join(dir, ".gstack", "session_state.json"), "utf-8"))
    assert.equal(sess.asked_about_design_system, true, "hook Python continua satisfeito")
    assert.equal(registerDesignSystem({ root: dir, choice: "none" }).status, "bypassed")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── gate pre-write ─────────────────────────────────────────────────────────────
test("evaluatePreWriteGate: bloqueia UI sem DS; libera bypassed/complete", async () => {
  const { evaluatePreWriteGate, persistGateEvidence } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-ds-gate-")
  try {
    const blocked = evaluatePreWriteGate({ root: dir, runId: "r1", uiIntended: true })
    assert.equal(blocked.blocked, true); assert.ok(blocked.violations.length > 0); assert.ok(blocked.requiredAction)
    const free = evaluatePreWriteGate({ root: dir, uiIntended: true, bypass: "none" })
    assert.equal(free.blocked, false)
    // sem intenção de UI, nunca bloqueia
    assert.equal(evaluatePreWriteGate({ root: dir, files: ["src/lib/x.js"] }).blocked, false)
    // persistência: gate.json sempre + violations quando bloqueado
    persistGateEvidence({ root: dir, runId: "r1", evidence: blocked })
    assert.ok(existsSync(path.join(dir, ".gstack", "runs", "r1", "design-system-gate.json")))
    assert.ok(existsSync(path.join(dir, ".gstack", "runs", "r1", "skill-gate-violations.json")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── wiring no start ────────────────────────────────────────────────────────────
const startOpts = (dir, extra = {}) => ({
  cwd: dir,
  classify: () => ({ state: "empty_dir", description: "", signals: {}, actions: [] }),
  exec: () => ({ ok: true }), gateExec: () => ({ ok: true, code: 0 }),
  devRunner: () => ({ services: [] }),
  verifyRunner: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
  scoutRunner: () => ({ status: "not_applicable", detail: "teste" }),
  // wizard determinístico: nome respondido, select = primeira opção (modo recomendado
  // + intake "não tenho"); sem isso o wizard penduraria no stdin sem TTY.
  prompt: async () => "proj",
  select: async (_q, choices) => choices[0],
  confirm: async () => true,
  ...extra,
})

test("start: objetivo frontend SEM design system → bloqueia execução (guarded)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mkProj("gstack-ds-start-")
  try {
    const r = await startCommand([], startOpts(dir, { objective: "criar dashboard de vendas com gráficos" }))
    assert.equal(r.executed, false)
    assert.equal(r.guarded, "design-system-gate")
    assert.equal(r.gate.blocked, true)
    const planId = (await import("node:fs")).readdirSync(path.join(dir, ".gstack", "plans"))[0]
    assert.ok(existsSync(path.join(dir, ".gstack", "plans", planId, "skill-gate-violations.json")), "violations persistidas")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("start: --design-system none libera (opt-out explícito) e executa", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mkProj("gstack-ds-bypass-")
  try {
    const r = await startCommand(["--design-system", "none"], startOpts(dir, { objective: "criar landing page bonita" }))
    assert.equal(r.executed, true, "com bypass o pipeline roda")
    assert.equal(r.skillRoute.detectedCapabilities.touchesFrontend, true)
    const routeDir = path.join(dir, ".gstack", "runs", r.pipeline.runId)
    assert.ok(existsSync(path.join(routeDir, "design-system-gate.json")), "evidência do gate no run")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── Design Direction v2 (PRD42 S42.2): gate valida CONTEÚDO, não só status ────────
test("v2: DS que declara conteúdo (generated) mas com tokens VAZIOS é bloqueado", async () => {
  const { evaluatePreWriteGate } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-dsv2-")
  try {
    writeGstack(dir, "design-system.json", { schemaVersion: "gstack.design-system.v2", status: "generated", tokens: { colors: {}, typography: {} } })
    const g = evaluatePreWriteGate({ root: dir, uiIntended: true })
    assert.equal(g.blocked, true, "conteúdo declarado e vazio deve bloquear (v1 passava só por status)")
    assert.match(g.violations[0].reason, /falta.*(colors|typography|direction)/i)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("v2: DS com direção + tokens (colors E typography) libera a escrita de UI", async () => {
  const { evaluatePreWriteGate } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-dsv2ok-")
  try {
    writeGstack(dir, "design-system.json", {
      schemaVersion: "gstack.design-system.v2", status: "generated",
      direction: "Dark, minimal, alto contraste", tokens: { colors: { primary: "#0A0A0A" }, typography: { body: "Inter" } },
    })
    assert.equal(evaluatePreWriteGate({ root: dir, uiIntended: true }).blocked, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("v2 migração: artefato v1 (só engine/path) é grandfathered — NÃO quebra projetos v1", async () => {
  const { evaluatePreWriteGate, resolveDesignSystem } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-dsv1-")
  try {
    writeGstack(dir, "design-system.json", { schemaVersion: "gstack.design-system.v1", engine: "custom", path: "ds/", status: "complete" })
    assert.equal(evaluatePreWriteGate({ root: dir, uiIntended: true }).blocked, false, "v1 externo continua liberando")
    const ds = resolveDesignSystem({ root: dir })
    assert.equal(ds.schemaVersion, "gstack.design-system.v2", "migrado para v2 na leitura")
    assert.equal(ds.declaresContent, false, "declaração externa não exige conteúdo inline")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("v2: validateDesignContent + migrateDesignSystem (unidade + CONTROLE NEGATIVO)", async () => {
  const { validateDesignContent, migrateDesignSystem, DESIGN_SYSTEM_SCHEMA_V2 } = await imp("src/skills/design-system.js")
  assert.equal(validateDesignContent({ direction: "x", tokens: { colors: { a: 1 }, typography: { b: 2 } } }).ok, true)
  const bad = validateDesignContent({ direction: "", tokens: {} })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.missing, ["direction", "tokens.colors", "tokens.typography"])
  assert.equal(validateDesignContent(null).ok, false, "nulo nunca é válido")
  // migração idempotente + preserva campos
  const m = migrateDesignSystem({ schemaVersion: "gstack.design-system.v1", status: "complete", path: "z" })
  assert.equal(m.schemaVersion, DESIGN_SYSTEM_SCHEMA_V2)
  assert.equal(m.migratedFrom, "gstack.design-system.v1")
  assert.equal(m.path, "z", "migração é não-destrutiva")
  assert.equal(migrateDesignSystem(m).schemaVersion, DESIGN_SYSTEM_SCHEMA_V2, "idempotente")
})

test("v2: registerDesignSystem grava schema v2 (declaração externa, contentValidated:false)", async () => {
  const { registerDesignSystem } = await imp("src/skills/design-system.js")
  const dir = mkProj("gstack-dsreg-")
  try {
    registerDesignSystem({ root: dir, choice: "my-ds/" })
    const ds = JSON.parse(readFileSync(path.join(dir, ".gstack", "design-system.json"), "utf8"))
    assert.equal(ds.schemaVersion, "gstack.design-system.v2")
    assert.equal(ds.contentValidated, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
