import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.7.5 — design context deixa de ser ilha.
 *
 * Achado: `buildProjections` (PRD49 S49.1) era real/puro/testado, mas o ÚNICO
 * chamador em todo o `src/` era `start.js` dentro de `dryRunReport()` — as
 * projeções só eram CALCULADAS pra um preview de `--dry-run`, nunca escritas,
 * nunca reconciliadas, e o design gate nunca consultava `projectionDriftStatus`.
 */

const DS = Object.freeze({
  schemaVersion: "gstack.design-system.v2",
  status: "complete",
  direction: "clean, técnico, alto contraste",
  tokens: { colors: { primary: "#0a0a0a" }, typography: { body: "Inter" } },
})

function tmpProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-dctx-"))
  mkdirSync(path.join(dir, ".gstack"), { recursive: true })
  return dir
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })

test("designContextStatus: nunca sincronizado -> absent (read-only, não escreve nada)", async () => {
  const { designContextStatus } = await imp("src/skills/design-context-sync.js")
  const dir = tmpProject()
  try {
    const st = designContextStatus({ cwd: dir, ds: DS })
    assert.equal(st.status, "absent")
    assert.ok(st.sourceHash)
    assert.equal(existsSync(path.join(dir, "DESIGN.md")), false, "status é read-only — nada foi escrito")
  } finally { cleanup(dir) }
})

test("syncDesignContext: apply:false devolve PLANO e não escreve nada (default seguro)", async () => {
  const { syncDesignContext } = await imp("src/skills/design-context-sync.js")
  const dir = tmpProject()
  try {
    const r = syncDesignContext({ cwd: dir, ds: DS, apply: false })
    assert.equal(r.applied, false)
    assert.ok(r.plans.length >= 3, "planeja as 3 projeções")
    assert.ok(r.plans.every((p) => p.action === "create"))
    assert.equal(existsSync(path.join(dir, "DESIGN.md")), false, "sem apply, nada em disco")
  } finally { cleanup(dir) }
})

test("syncDesignContext: apply:true escreve as projeções REAIS e registra proveniência", async () => {
  const { syncDesignContext, readSyncProvenance } = await imp("src/skills/design-context-sync.js")
  const dir = tmpProject()
  try {
    const r = syncDesignContext({ cwd: dir, ds: DS, apply: true })
    assert.equal(r.applied, true)
    assert.ok(existsSync(path.join(dir, "DESIGN.md")), "DESIGN.md escrito de verdade")
    assert.ok(existsSync(path.join(dir, "PRODUCT.md")))
    assert.ok(existsSync(path.join(dir, ".impeccable", "design.json")))
    const prov = readSyncProvenance(dir)
    assert.equal(prov.sourceHash, r.sourceHash)
    assert.ok(prov.syncedAt)
  } finally { cleanup(dir) }
})

test("após sync, o status vira fresh (o hash bate com a proveniência)", async () => {
  const { syncDesignContext, designContextStatus } = await imp("src/skills/design-context-sync.js")
  const dir = tmpProject()
  try {
    syncDesignContext({ cwd: dir, ds: DS, apply: true })
    assert.equal(designContextStatus({ cwd: dir, ds: DS }).status, "fresh")
  } finally { cleanup(dir) }
})

test("canônico MUDOU depois do sync -> status stale (drift real detectado)", async () => {
  const { syncDesignContext, designContextStatus } = await imp("src/skills/design-context-sync.js")
  const dir = tmpProject()
  try {
    syncDesignContext({ cwd: dir, ds: DS, apply: true })
    const mudado = { ...DS, direction: "outra direção completamente diferente" }
    assert.equal(designContextStatus({ cwd: dir, ds: mudado }).status, "stale")
  } finally { cleanup(dir) }
})

// A invariante central herdada do PRD49: edição humana NUNCA é sobrescrita.
test("CONTROLE NEGATIVO: arquivo editado à mão NUNCA é sobrescrito — vira conflito de reconciliação", async () => {
  const { syncDesignContext } = await imp("src/skills/design-context-sync.js")
  const dir = tmpProject()
  try {
    syncDesignContext({ cwd: dir, ds: DS, apply: true })
    const designMd = path.join(dir, "DESIGN.md")
    writeFileSync(designMd, "# EDITADO À MÃO PELO HUMANO\nconteúdo que não pode sumir\n")
    // canônico muda -> sync tentaria reescrever; a edição humana tem que barrar isso.
    const mudado = { ...DS, direction: "direção nova" }
    const r = syncDesignContext({ cwd: dir, ds: mudado, apply: true })
    assert.ok(r.conflicts.length >= 1, "edição humana vira conflito")
    assert.match(readFileSync(designMd, "utf-8"), /EDITADO À MÃO/, "conteúdo humano preservado byte a byte")
    assert.ok(!(r.written || []).includes("DESIGN.md"), "DESIGN.md não foi reescrito")
  } finally { cleanup(dir) }
})

test("CONTROLE NEGATIVO: arquivo preexistente sem proveniência é tratado como possivelmente humano (conservador)", async () => {
  const { syncDesignContext } = await imp("src/skills/design-context-sync.js")
  const dir = tmpProject()
  try {
    writeFileSync(path.join(dir, "DESIGN.md"), "# preexistente, origem desconhecida\n")
    const r = syncDesignContext({ cwd: dir, ds: DS, apply: true })
    assert.ok(r.conflicts.length >= 1, "sem saber se geramos, nunca sobrescreve")
    assert.match(readFileSync(path.join(dir, "DESIGN.md"), "utf-8"), /origem desconhecida/)
  } finally { cleanup(dir) }
})

// Wiring REAL no gate: drift é ADVISORY, jamais bloqueia.
test("wiring REAL: evaluatePreWriteGate reporta designContext quando o leitor é injetado", async () => {
  const { evaluatePreWriteGate } = await imp("src/skills/design-system.js")
  const { designContextStatus } = await imp("src/skills/design-context-sync.js")
  const dir = tmpProject()
  try {
    writeFileSync(path.join(dir, ".gstack", "design-system.json"), JSON.stringify(DS))
    const ev = evaluatePreWriteGate({ root: dir, uiIntended: true, contextStatus: designContextStatus })
    assert.ok(ev.designContext, "gate passa a carregar o sinal de contexto")
    assert.equal(ev.designContext.advisory, true)
    assert.equal(ev.designContext.status, "absent", "nunca sincronizado neste projeto")
    assert.equal(ev.blocked, false, "DS completo -> não bloqueia; drift NUNCA bloqueia")
  } finally { cleanup(dir) }
})

test("CONTROLE NEGATIVO: drift stale NUNCA bloqueia o gate (só o DS ausente/inválido bloqueia)", async () => {
  const { evaluatePreWriteGate } = await imp("src/skills/design-system.js")
  const dir = tmpProject()
  try {
    writeFileSync(path.join(dir, ".gstack", "design-system.json"), JSON.stringify(DS))
    const staleReader = () => ({ status: "stale", sourceHash: "abc123" })
    const ev = evaluatePreWriteGate({ root: dir, uiIntended: true, contextStatus: staleReader })
    assert.equal(ev.designContext.status, "stale")
    assert.equal(ev.blocked, false, "drift é advisory — jamais bloqueia")
  } finally { cleanup(dir) }
})

test("retrocompat: sem contextStatus injetado, o gate é IDÊNTICO ao anterior (sem campo novo)", async () => {
  const { evaluatePreWriteGate } = await imp("src/skills/design-system.js")
  const dir = tmpProject()
  try {
    writeFileSync(path.join(dir, ".gstack", "design-system.json"), JSON.stringify(DS))
    const ev = evaluatePreWriteGate({ root: dir, uiIntended: true })
    assert.equal(ev.designContext, undefined, "sem leitor injetado, nenhum campo novo aparece")
  } finally { cleanup(dir) }
})

test("best-effort: leitor de contexto que LANÇA nunca derruba o gate", async () => {
  const { evaluatePreWriteGate } = await imp("src/skills/design-system.js")
  const dir = tmpProject()
  try {
    writeFileSync(path.join(dir, ".gstack", "design-system.json"), JSON.stringify(DS))
    const boom = () => { throw new Error("leitor quebrado") }
    const ev = evaluatePreWriteGate({ root: dir, uiIntended: true, contextStatus: boom })
    assert.equal(ev.designContext, undefined)
    assert.equal(ev.blocked, false, "gate segue funcionando")
  } finally { cleanup(dir) }
})

// CLI real.
test("wiring REAL: `visual context status --json` roda de verdade e reporta drift", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = tmpProject()
  writeFileSync(path.join(dir, ".gstack", "design-system.json"), JSON.stringify(DS))
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try { await visualCommand(["context", "status", "--json"], { cwd: dir }) } finally { process.stdout.write = orig; cleanup(dir) }
  const out = JSON.parse(buf.trim())
  assert.equal(out.schemaVersion, "gstack.design-context-sync.v1")
  assert.equal(out.status, "absent")
})

test("wiring REAL: `visual context sync` sem --yes e sem TTY devolve PLANO, nunca escreve", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = tmpProject()
  writeFileSync(path.join(dir, ".gstack", "design-system.json"), JSON.stringify(DS))
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try { await visualCommand(["context", "sync", "--json"], { cwd: dir }) } finally { process.stdout.write = orig }
  try {
    const out = JSON.parse(buf.trim())
    assert.equal(out.applied, false, "sem consentimento, nada é aplicado")
    assert.equal(existsSync(path.join(dir, "DESIGN.md")), false, "nada escrito em disco")
  } finally { cleanup(dir) }
})

test("wiring REAL: `visual context sync --yes` escreve de verdade", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = tmpProject()
  writeFileSync(path.join(dir, ".gstack", "design-system.json"), JSON.stringify(DS))
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try { await visualCommand(["context", "sync", "--yes", "--json"], { cwd: dir }) } finally { process.stdout.write = orig }
  try {
    const out = JSON.parse(buf.trim())
    assert.equal(out.applied, true)
    assert.ok(existsSync(path.join(dir, "DESIGN.md")))
  } finally { cleanup(dir) }
})
