import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const mod = path.resolve(import.meta.dirname, "..", "src", "agents", "factory.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("Execution Contract: hasExecutionContract + withExecutionContract (idempotente)", async () => {
  const { EXECUTION_CONTRACT, hasExecutionContract, withExecutionContract } = await imp()
  assert.equal(hasExecutionContract("texto qualquer"), false)
  assert.equal(hasExecutionContract(EXECUTION_CONTRACT), true)
  const once = withExecutionContract("# Agente\n\ncorpo")
  assert.equal(hasExecutionContract(once), true)
  assert.match(once, /LLM cross-review is advisory only/)
  assert.match(once, /treat the gate as blocked, not passed/)
  // idempotente: aplicar de novo não duplica o bloco
  const twice = withExecutionContract(once)
  assert.equal((twice.match(/## GStack Execution Contract/g) || []).length, 1)
})

test("hashFiles: determinístico e sensível a conteúdo/ordem-independente", async () => {
  const { hashFiles, sha256 } = await imp()
  const a = hashFiles([{ rel: "b.md", content: "2" }, { rel: "a.md", content: "1" }])
  const b = hashFiles([{ rel: "a.md", content: "1" }, { rel: "b.md", content: "2" }])
  assert.equal(a, b, "ordem dos arquivos não importa (ordena por rel)")
  assert.notEqual(a, hashFiles([{ rel: "a.md", content: "1" }, { rel: "b.md", content: "MUDOU" }]), "muda conteúdo → muda hash")
  assert.match(sha256("x"), /^sha256:[0-9a-f]{64}$/)
})

test("buildManifestV2: schemaVersion 2, hashes, adapters, sem generatedAt por padrão", async () => {
  const { buildManifestV2 } = await imp()
  const m = buildManifestV2({
    compilerVersion: "9.9.9",
    coreFiles: [{ rel: "core/a.md", content: "x" }],
    knowledgeFiles: [], agentFiles: [{ rel: "agents/agents/x.md", content: "y" }],
    adapters: { claude: ["f1"], codex: ["f2"], cursor: ["f3"] },
    security: { critical: 0, high: 1, verdict: "pass" },
  })
  assert.equal(m.schemaVersion, 2)
  assert.equal(m.compilerVersion, "9.9.9")
  assert.equal(m.generatedAt, undefined, "determinístico — sem timestamp")
  assert.match(m.source.coreHash, /^sha256:/)
  assert.equal(m.adapters.opencode.status, "compat_cursor")
  assert.equal(m.security.high, 1)
})

// ── ABUSO: evaluateDrift pega stale, manifest legado e contrato ausente ──
test("evaluateDrift: detecta hash divergente, manifest v1 e adapter sem contrato", async () => {
  const { evaluateDrift, EXECUTION_CONTRACT } = await imp()
  const good = {
    manifest: { schemaVersion: 2, compilerVersion: "1", source: { coreHash: "sha256:aa", knowledgeHash: "sha256:bb", agentsHash: "sha256:cc" } },
    expected: { coreHash: "sha256:aa", knowledgeHash: "sha256:bb", agentsHash: "sha256:cc", compilerVersion: "1" },
    adapterTexts: [{ path: "claude/x", text: "corpo\n" + EXECUTION_CONTRACT }],
  }
  assert.equal(evaluateDrift(good).ok, true)

  // hash de fonte divergente → generated stale
  const stale = evaluateDrift({ ...good, expected: { ...good.expected, coreHash: "sha256:OUTRO" } })
  assert.equal(stale.ok, false)
  assert.ok(stale.drift.some((d) => d.kind === "source-drift"))

  // adapter sem o Execution Contract
  const noContract = evaluateDrift({ ...good, adapterTexts: [{ path: "claude/x", text: "corpo sem contrato" }] })
  assert.ok(noContract.drift.some((d) => d.kind === "missing-contract"))

  // manifest v1 (legado)
  const legacy = evaluateDrift({ manifest: { schemaVersion: 1 }, expected: {}, adapterTexts: [] })
  assert.ok(legacy.drift.some((d) => d.kind === "manifest-legacy"))

  // manifest ausente
  assert.equal(evaluateDrift({ manifest: null }).ok, false)
})
