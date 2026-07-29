import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.7.3 — "uma próxima ação segura para cada falha importante".
 * PRD48 §3.2 P2.2 era o ÚNICO item da checklist que nenhum sprint anterior
 * endereçou (`sprint:"-"`, `status:"pending"`, `proof:null`).
 */

test("safeNextAction: toda falha registrada tem texto humano e é marcada como segura", async () => {
  const { safeNextAction, KNOWN_FAILURE_IDS } = await imp("src/skills/safe-next-action.js")
  assert.ok(KNOWN_FAILURE_IDS.length >= 6, "cobre as falhas reais mapeadas")
  for (const id of KNOWN_FAILURE_IDS) {
    const a = safeNextAction(id)
    assert.ok(a.humanText && a.humanText.length > 10, `${id} tem texto humano real`)
    assert.equal(a.safe, true, `${id} é ação segura por construção`)
    assert.equal(a.failureId, id)
  }
})

test("CONTROLE NEGATIVO: falha desconhecida devolve null — NUNCA inventa uma ação", async () => {
  const { safeNextAction } = await imp("src/skills/safe-next-action.js")
  assert.equal(safeNextAction("falha_que_nao_existe"), null)
  assert.equal(safeNextAction(undefined), null)
})

// A ação sugerida nunca pode ser um contorno: nada de --force, nada de
// desligar gate. É a diferença entre "próxima ação SEGURA" e "como burlar".
test("CONTROLE NEGATIVO: nenhuma ação sugerida contorna gate ou destrói trabalho", async () => {
  const { safeNextAction, KNOWN_FAILURE_IDS } = await imp("src/skills/safe-next-action.js")
  const UNSAFE = /--force\b|--no-verify|--skip|rm\s+-rf|--allow-degraded|desligue|desabilite/i
  for (const id of KNOWN_FAILURE_IDS) {
    const a = safeNextAction(id)
    assert.ok(!UNSAFE.test(a.command || ""), `${id}: comando nunca contorna gate`)
    assert.ok(!UNSAFE.test(a.humanText), `${id}: texto nunca sugere contorno`)
  }
})

test("safeNextAction: detail real da ocorrência é anexado sem substituir o texto base", async () => {
  const { safeNextAction } = await imp("src/skills/safe-next-action.js")
  const a = safeNextAction("first_run_blocked", "nenhum executor apto e a tarefa exige LLM")
  assert.match(a.detail, /nenhum executor apto/)
  assert.ok(a.humanText.length > 10, "texto base preservado")
})

test("renderSafeNextAction: com comando inclui a seta; sem comando não inventa comando", async () => {
  const { safeNextAction, renderSafeNextAction } = await imp("src/skills/safe-next-action.js")
  assert.match(renderSafeNextAction(safeNextAction("proof_blocked")), /→ gstack_vibehard proof/)
  assert.ok(!renderSafeNextAction(safeNextAction("plan_invalid")).includes("→"), "sem comando, sem seta")
  assert.equal(renderSafeNextAction(null), null)
})

// Wiring REAL nas superfícies de falha (não só o módulo isolado).
test("wiring REAL: start com harness bloqueado imprime a próxima ação segura", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-sna-"))
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try {
    await startCommand([], {
      cwd: dir, objective: "cli tool", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      detectHarnessProfiles: () => [],
    })
  } finally { process.stdout.write = orig; await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
  assert.match(buf, /Próxima ação segura/, "falha de first-run oferece próxima ação")
  assert.match(buf, /gstack_vibehard doctor/, "com o comando real")
})

test("wiring REAL: policy eval com deny imprime a próxima ação segura (nunca sugere bypass)", async () => {
  const { policyCommand } = await imp("src/commands/policy.js")
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try { policyCommand(["eval", "Write(.env)"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  assert.match(buf, /Próxima ação segura/)
  assert.match(buf, /policy show/, "aponta o comando de policy, nunca um bypass")
  assert.ok(!/--force/.test(buf))
})

test("wiring REAL: design-system-gate --json carrega nextAction na MESMA forma compartilhada", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-sna-ds-"))
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try {
    await startCommand(["--json"], {
      cwd: dir, objective: "web app com dashboard", projectName: "app", mode: "lite",
      confirm: async () => true, exec: () => {},
      detectHarnessProfiles: () => ([{ harness: "claude", installed: true, callable: true, enforcement: "native_enforced" }]),
    })
  } finally { process.stdout.write = orig; await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
  const line = buf.split("\n").find((l) => l.includes("design-system-gate"))
  assert.ok(line, "o gate bloqueou como esperado")
  const out = JSON.parse(line)
  assert.equal(out.nextAction.schemaVersion, "gstack.safe-next-action.v1")
  assert.equal(out.nextAction.failureId, "design_system_missing")
  assert.equal(out.nextAction.safe, true)
})
