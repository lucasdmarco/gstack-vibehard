import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD42 S42.0A — honestidade de claims e metadata de harness.
//  (1) Texto gerado ao usuário não pode afirmar percentual de economia sem medição.
//  (2) Metadata de harness não pode dizer "agent-hooks" onde a matriz honesta
//      (adapter-matrix) classifica enforcement < real_hooks.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("guidance instrucional não afirma percentual de economia sem medição (95%/60-80%)", async () => {
  const { INSTRUCTIONAL_GUIDANCE } = await imp("src/harness/instructional.js")
  assert.ok(INSTRUCTIONAL_GUIDANCE, "INSTRUCTIONAL_GUIDANCE exportado")
  assert.doesNotMatch(INSTRUCTIONAL_GUIDANCE, /\d+\s*%/, "sem número % cravado no texto do usuário")
  assert.doesNotMatch(INSTRUCTIONAL_GUIDANCE, /ate\s*95/i, "sem 'até 95%'")
})

test("metadata OMNIHARNESS não rotula 'agent-hooks' onde a matriz diz enforcement < real_hooks", async () => {
  const { OMNIHARNESS_MAP } = await imp("src/cli/create.js")
  const { ADAPTER_MATRIX } = await imp("src/agents/adapter-matrix.js")
  assert.ok(Array.isArray(OMNIHARNESS_MAP), "OMNIHARNESS_MAP exportado")
  for (const h of OMNIHARNESS_MAP) {
    const info = ADAPTER_MATRIX[h.id]
    if (!info) continue // harness fora da matriz (delivery-only) — não afirma hooks
    if (h.mode === "agent-hooks") {
      assert.equal(info.enforcement, "real_hooks",
        `${h.id}: mode 'agent-hooks' exige enforcement real_hooks na matriz, mas é '${info.enforcement}'`)
    }
  }
})

test("CONTROLE NEGATIVO — claude (real_hooks) pode ser agent-hooks; cursor/codex/windsurf não", async () => {
  const { OMNIHARNESS_MAP } = await imp("src/cli/create.js")
  const byId = Object.fromEntries(OMNIHARNESS_MAP.map((h) => [h.id, h.mode]))
  assert.equal(byId.claude, "agent-hooks", "claude é real_hooks → agent-hooks honesto")
  for (const id of ["cursor", "codex", "windsurf", "opencode"]) {
    assert.notEqual(byId[id], "agent-hooks", `${id} não é real_hooks → não pode ser agent-hooks`)
  }
})
