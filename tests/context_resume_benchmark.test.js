import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.5 — "retomada mede bytes/tokens do Context Delta contra recontextualização
// total em benchmark reproduzível". Reusa resumeBenchmark real (handoff.js, S42.10) — não
// duplica a heurística de estimativa. Números SEMPRE `estimated`, nunca "economia comprovada"
// sem A/B real (proibido publicar percentual sem isso — DoD).

test("benchmark reproduzível: mesmo Context Delta produz SEMPRE a mesma razão (determinístico)", async () => {
  const { buildContextDelta } = await imp("src/project-plan/context-delta.js")
  const { resumeBenchmark } = await imp("src/project-plan/handoff.js")
  const delta = buildContextDelta({
    brief: { objective: "SaaS com login e Stripe", mode: "delivery" },
    decisions: [{ id: "designDirection", value: "minimal-editorial" }],
    checkpoint: { seq: 3, hash: "sha256:abc", green: true },
    touchedFiles: ["apps/api/src/index.ts", "apps/web/app/page.tsx"],
  })
  const fullText = "x".repeat(50000) // simula recontextualização total (reler o repositório)
  const r1 = resumeBenchmark({ handoffText: JSON.stringify(delta), fullText })
  const r2 = resumeBenchmark({ handoffText: JSON.stringify(delta), fullText })
  assert.equal(r1.ratio, r2.ratio, "mesmo delta -> sempre a mesma razão, reproduzível")
})

test("Context Delta real é significativamente menor que a recontextualização total simulada — retomada avoided real, não inventado", async () => {
  const { buildContextDelta } = await imp("src/project-plan/context-delta.js")
  const { resumeBenchmark } = await imp("src/project-plan/handoff.js")
  const delta = buildContextDelta({
    brief: { objective: "SaaS com login e Stripe", mode: "delivery" },
    checkpoint: { seq: 1, hash: "sha256:abc", green: true },
    touchedFiles: ["apps/api/src/index.ts"],
  })
  const fullText = "x".repeat(50000)
  const bench = resumeBenchmark({ handoffText: JSON.stringify(delta), fullText })
  assert.ok(bench.ratio < 1, "Context Delta é menor que reler tudo")
  assert.equal(bench.savings.source, "estimated", "NUNCA apresentado como economia comprovada sem A/B (DoD)")
})

test("números do resumo de sessão são explicáveis: cada campo diz se é medido ou estimado (DoD)", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const r = buildSessionSummary({ inputTokens: 1000, contextPackBytes: 500, fullBytes: 5000, quota: { available: 4, needed: 1 } })
  const qualities = [r.inputTokens.quality, r.outputTokens.quality, r.contextAvoided.quality, r.quota.quality]
  for (const q of qualities) assert.ok(["measured", "provider_reported", "estimated", "unknown"].includes(q))
})
