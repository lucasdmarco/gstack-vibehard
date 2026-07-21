import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.7 (P1.12) — a fábrica compilava 22 agentes, mas só 3 receberam knowledge pack; os
// outros 19 receberam zero. Mesmo assim todos eram anunciados igual — o usuário podia escolher
// um "security auditor" sem evidência de conhecimento de domínio. Correção: status HONESTO por
// agente — `generic_adapter` (sem pack) | `specialized` (com pack) | `verified` (pack + teste
// comportamental). Agente sem pack NÃO pode ser anunciado como especialista verificado.

const mod = path.resolve(import.meta.dirname, "..", "src", "agents", "factory.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("classifyAgentSpecialization: 0 packs = generic_adapter (nunca 'especialista')", async () => {
  const { classifyAgentSpecialization } = await imp()
  assert.equal(classifyAgentSpecialization({ knowledgePacks: 0 }).status, "generic_adapter")
  assert.equal(classifyAgentSpecialization({ knowledgePacks: 0 }).specialist, false, "CONTROLE NEGATIVO: sem pack não é especialista")
})

test("classifyAgentSpecialization: ≥1 pack = specialized; + teste = verified", async () => {
  const { classifyAgentSpecialization } = await imp()
  assert.equal(classifyAgentSpecialization({ knowledgePacks: 2 }).status, "specialized")
  assert.equal(classifyAgentSpecialization({ knowledgePacks: 2 }).specialist, true)
  const v = classifyAgentSpecialization({ knowledgePacks: 1, behavioralVerified: true })
  assert.equal(v.status, "verified", "pack + prova comportamental = verified")
  // CONTROLE NEGATIVO: `verified` exige pack — sem pack, behavioralVerified não eleva.
  assert.equal(classifyAgentSpecialization({ knowledgePacks: 0, behavioralVerified: true }).status, "generic_adapter")
})

test("buildSpecializationSummary: conta por status e lista os genéricos (transparência)", async () => {
  const { buildSpecializationSummary } = await imp()
  const s = buildSpecializationSummary([
    { id: "devops", knowledgePacks: 3 },
    { id: "frontend", knowledgePacks: 1, behavioralVerified: true },
    { id: "security-auditor", knowledgePacks: 0 },
    { id: "database-architect", knowledgePacks: 0 },
  ])
  assert.equal(s.counts.generic_adapter, 2)
  assert.equal(s.counts.specialized, 1)
  assert.equal(s.counts.verified, 1)
  assert.equal(s.total, 4)
  assert.deepEqual(s.generic.sort(), ["database-architect", "security-auditor"], "lista quem é só genérico (não pode virar 'especialista verificado')")
})

test("buildManifestV2: inclui o bloco specialization (status honesto no artefato)", async () => {
  const { buildManifestV2 } = await imp()
  const m = buildManifestV2({ compilerVersion: "1.0.0", agents: [{ id: "a", knowledgePacks: 1 }, { id: "b", knowledgePacks: 0 }] })
  assert.ok(m.specialization, "manifest declara specialization")
  assert.equal(m.specialization.counts.specialized, 1)
  assert.equal(m.specialization.counts.generic_adapter, 1)
})

test("compat: buildManifestV2 sem `agents` estruturado não quebra (agentsCount ainda vale)", async () => {
  const { buildManifestV2 } = await imp()
  const m = buildManifestV2({ compilerVersion: "1.0.0", agentsCount: 5 })
  assert.equal(m.agents, 5, "contagem preservada")
  assert.equal(m.specialization.total, 0, "sem lista estruturada, specialization é vazio (honesto)")
})
