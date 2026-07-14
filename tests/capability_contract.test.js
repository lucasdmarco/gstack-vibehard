import test from "node:test"
import assert from "node:assert/strict"

// PRD42 S42.0B / §5.11 — Capability Truth Contract. Uma capacidade só é `real` quando o
// backend foi EXERCITADO (runtime healthy + probe + controle negativo). Presença de arquivo
// é no máximo `configured` → claim `not_proved`. Lite exclui capacidades Full. Suporte é
// POR PLATAFORMA (sucesso Linux não promove Windows).

test("validateCapabilityContract: contrato completo passa; faltando campo reprova", async () => {
  const { validateCapabilityContract, CAPABILITY_CONTRACT_SCHEMA } = await import("../src/capabilities/contract.js")
  const ok = {
    schemaVersion: CAPABILITY_CONTRACT_SCHEMA, component: "casdoor", mode: "full",
    obligation: "required", installState: "configured", runtimeState: "not_started",
    enforcement: "adapter_enforced",
    platformSupport: { linux: "supported", macos: "supported", windows: "wsl_only" },
    evidence: { adapter: "x", probe: "y", negativeControl: "z", artifactHash: "sha256:..", freshAt: "2026-07-14" },
    claim: "not_proved",
  }
  assert.equal(validateCapabilityContract(ok).valid, true)
  const bad = { ...ok }; delete bad.platformSupport
  assert.equal(validateCapabilityContract(bad).valid, false, "sem platformSupport reprova")
})

test("gradeCapabilityClaim: arquivo presente ≠ real; só backend exercitado é real", async () => {
  const { gradeCapabilityClaim } = await import("../src/capabilities/contract.js")
  const base = {
    obligation: "required", platformSupport: { linux: "supported" }, platform: "linux",
    evidence: { probe: "p", negativeControl: "n" },
  }
  // Configurado mas sem runtime provado → not_proved (arquivo não basta).
  assert.equal(gradeCapabilityClaim({ ...base, installState: "configured", runtimeState: "not_started" }), "not_proved")
  // Runtime saudável + probe + controle negativo → real.
  assert.equal(gradeCapabilityClaim({ ...base, installState: "installed", runtimeState: "healthy" }), "real")
  // Sem controle negativo → NÃO é real (não prova que a capacidade realmente age).
  assert.equal(gradeCapabilityClaim({ ...base, installState: "installed", runtimeState: "healthy", evidence: { probe: "p" } }), "not_proved")
  // Degradado é degradado; excluído é excluído; plataforma sem suporte é unsupported.
  assert.equal(gradeCapabilityClaim({ ...base, runtimeState: "degraded" }), "degraded")
  assert.equal(gradeCapabilityClaim({ ...base, obligation: "excluded" }), "excluded")
  assert.equal(gradeCapabilityClaim({ ...base, platform: "windows", platformSupport: { windows: "unsupported" } }), "unsupported")
})

test("registry: OpenHands honesto (Windows wsl_only, claim not_proved), Lite exclui backends Full", async () => {
  const { contractFor, CAPABILITY_IDS } = await import("../src/capabilities/registry.js")
  const oh = contractFor("openhands", "full")
  assert.ok(oh, "openhands no registro")
  assert.ok(["wsl_only", "unsupported"].includes(oh.platformSupport.windows), "Windows não é 'supported' sem prova WSL")
  assert.equal(oh.claim, "not_proved", "OpenHands não é real por arquivo — exige E2E de sandbox")

  // Em LITE, os backends do Full são EXCLUÍDOS (nenhum arquivo/processo/claim).
  for (const id of ["casdoor", "atomic", "agentmemory", "openhands"]) {
    const lite = contractFor(id, "lite")
    assert.equal(lite.obligation, "excluded", `${id} é excluído em Lite`)
    assert.equal(lite.claim, "excluded", `${id} claim=excluded em Lite`)
  }
  assert.ok(Array.isArray(CAPABILITY_IDS) && CAPABILITY_IDS.includes("casdoor"))
})

test("CONTROLE NEGATIVO — em FULL os backends são required (não excluídos)", async () => {
  const { contractFor } = await import("../src/capabilities/registry.js")
  const casdoor = contractFor("casdoor", "full")
  assert.equal(casdoor.obligation, "required", "casdoor é required no Full")
  assert.notEqual(casdoor.claim, "excluded", "no Full não é excluído")
})
