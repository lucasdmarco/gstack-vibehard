import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.4 — controles negativos: restore em dirty tree externa nunca toca arquivo fora
// do checkpoint; `--yes` nunca ultrapassa categoria sensível (cloud/deploy/secret/destrutivo).

test("restoreWithProvenance: restore NUNCA toca arquivo FORA do checkpoint, mesmo se ele estiver dirty (tree externa preservada)", async () => {
  const { restoreWithProvenance } = await imp("src/skills/checkpoint-presenter.js")
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = mkdtempSync(path.join(tmpdir(), "gstack-restore-dirty-"))
  try {
    writeFileSync(path.join(root, "tracked.txt"), "verde")
    const ckpt = createCheckpoint({ root, runId: "run-1", files: ["tracked.txt"], green: true })
    writeFileSync(path.join(root, "tracked.txt"), "quebrado")
    // arquivo NÃO tracked pelo checkpoint, com alteração do usuário (dirty externo).
    writeFileSync(path.join(root, "untouched.txt"), "alteração do usuário, sem relação com o checkpoint")
    restoreWithProvenance({ root, runId: "run-1", seq: ckpt.seq })
    assert.equal(readFileSync(path.join(root, "tracked.txt"), "utf-8"), "verde", "arquivo do checkpoint restaurado")
    assert.equal(readFileSync(path.join(root, "untouched.txt"), "utf-8"), "alteração do usuário, sem relação com o checkpoint", "arquivo FORA do checkpoint jamais tocado")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("yesFlagBypassesGate: --yes NUNCA ultrapassa categoria sensível (cloud/deploy/secret/destrutivo/rede/fora-do-projeto)", async () => {
  const { yesFlagBypassesGate, SENSITIVE_CATEGORIES } = await imp("src/policy/decision-presenter.js")
  for (const cat of SENSITIVE_CATEGORIES) assert.equal(yesFlagBypassesGate(cat), false, `--yes nunca ultrapassa ${cat}`)
  assert.equal(yesFlagBypassesGate("read_only"), true)
})

test("presentDecision + canPersistChoice: 'ask' em ação sensível nunca oferece persistência, mesmo respondendo allow_once", async () => {
  const { presentDecision, canPersistChoice } = await imp("src/policy/decision-presenter.js")
  const evaluation = { decision: "ask", rule: "Exec(git push --force)" }
  const r = presentDecision({ action: "git push --force", target: "origin/main", risk: "reescreve histórico remoto", evaluation })
  assert.ok(r.choices.includes("allow_once"), "permite UMA vez")
  assert.equal(canPersistChoice("destructive"), false, "mas nunca persiste pra categoria destrutiva")
})
