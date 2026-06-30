import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { HARNESS_CAPABILITIES } from "./capabilities.js"

/**
 * Auditor anti-placebo (PRD Fase 3 §1). DETERMINÍSTICO, sem LLM, somente-leitura:
 * compara PROMESSAS (docs/CLAUDE.md/README) contra EVIDÊNCIA real no código
 * (comandos registrados, módulos, testes). Classifica cada claim:
 *   REAL | PARTIAL | PLACEBO | ROADMAP | RISK
 */
const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

function reader(root) {
  return {
    has: (rel) => existsSync(join(root, rel)),
    read: (rel) => { try { return readFileSync(join(root, rel), "utf-8") } catch { return "" } },
  }
}

function cliHasCommand(read, cmd) {
  return read("src/cli/index.js").includes(`case "${cmd}"`)
}

export function audit(opts = {}) {
  const root = opts.root || DEFAULT_ROOT
  const { has, read } = reader(root)
  const claims = []
  const add = (c) => claims.push(c)

  // 1. "Auto-dream ON" (CLAUDE.md) — só vira REAL com o ciclo improve+accept/reject.
  {
    const evidence = []
    if (has("src/commands/dream.js")) evidence.push("src/commands/dream.js")
    if (has("src/dream/auditor.js")) evidence.push("src/dream/auditor.js")
    const hasImprove = has("src/dream/runner.js") && cliHasCommand(read, "dream") && read("src/commands/dream.js").includes("improve")
    add({
      id: "auto-dream", claim: "Auto-dream ON (auto-melhoria)",
      status: hasImprove ? "REAL" : "PARTIAL", severity: "P1",
      evidence, missing: hasImprove ? [] : ["dream improve isolado", "accept/reject", "harness adapters"],
    })
  }

  // 2. Output Guard Zero-Trust — só pós-resposta (Stop hook); sem intercept pré-render.
  {
    const preOutput = Object.values(HARNESS_CAPABILITIES).some((c) => c.supportsPreOutputInterception)
    add({
      id: "output-guard", claim: "Output Guard / Zero-Trust de saída",
      status: preOutput ? "REAL" : "RISK", severity: "P1",
      evidence: ["hooks/hooks/_output_guard.py", "hooks/hooks/stop.py"].filter(has),
      missing: preOutput ? [] : ["redaction pré-render (Stop hook é auditoria posterior)"],
    })
  }

  // 3. verify delivery gates — REAL (comando + status honesto + testes).
  add({
    id: "verify", claim: "Delivery gates (verify) honestos",
    status: (cliHasCommand(read, "verify") && has("tests/verify_gates.test.js")) ? "REAL" : "PARTIAL", severity: "P2",
    evidence: ["src/commands/verify.js", "src/project-plan/verify-runner.js"].filter(has), missing: [],
  })

  // 4. Manifest/backup/rollback — REAL.
  add({
    id: "rollback", claim: "Instala tudo com rollback (manifest/backup)",
    status: (has("src/installer/safe-write.js") && has("src/installer/manifest.js") && cliHasCommand(read, "uninstall")) ? "REAL" : "PARTIAL",
    severity: "P2", evidence: ["src/installer/safe-write.js", "src/installer/manifest.js", "src/installer/integrity.js"].filter(has), missing: [],
  })

  // 5. Cross-harness "Zero-Trust corporativo" — PARTIAL: há harness só instrucional.
  {
    const weak = Object.values(HARNESS_CAPABILITIES).filter((c) => c.trustLevel !== "strong").map((c) => c.id)
    add({
      id: "cross-harness-trust", claim: "Segurança Zero-Trust cross-harness",
      status: "PARTIAL", severity: "P1",
      evidence: ["src/dream/capabilities.js", "src/harness/instructional.js"].filter(has),
      missing: [`harness best-effort não impõem gates: ${weak.join(", ")}`],
    })
  }

  // 6. OpenCode safe — REAL (conservador); merge assistido JSONC ainda ROADMAP.
  {
    const assisted = read("src/installer/doctor.js").includes("--fix")
    add({
      id: "opencode-safe", claim: "OpenCode sem sombrear .jsonc",
      status: has("src/harness/opencode-config.js") ? (assisted ? "REAL" : "PARTIAL") : "PLACEBO", severity: "P2",
      evidence: ["src/harness/opencode-config.js"].filter(has),
      missing: assisted ? [] : ["doctor --fix com merge assistido JSONC"],
    })
  }

  // 7. Loop Engineer task — REAL: executa o loop em WORKTREE (worktree→diff→hygiene→accept/reject).
  {
    const ok = has("src/project-plan/task-loop.js") && has("src/commands/task-run.js") &&
      has("tests/task_loop.test.js") && read("src/commands/task.js").includes("taskRunCommand")
    add({
      id: "task-loop", claim: "Loop Engineer (task) executa em worktree (diff/hygiene/accept/reject)",
      status: ok ? "REAL" : "PARTIAL", severity: "P2",
      evidence: ["src/project-plan/task-loop.js", "src/commands/task-run.js", "src/commands/task.js"].filter(has),
      missing: ok ? [] : ["execução do loop (worktree/diff/accept)"],
    })
  }

  // 8. Runtime Supervisor (PRD 12 PR4) — REAL: dev/stop sobem/derrubam serviços.
  {
    const ok = cliHasCommand(read, "dev") && cliHasCommand(read, "stop") && has("src/runtime/supervisor.js") && has("tests/runtime_supervisor.test.js")
    add({
      id: "runtime-supervisor", claim: "Runtime: dev/stop sobem e derrubam serviços",
      status: ok ? "REAL" : "PARTIAL", severity: "P1",
      evidence: ["src/runtime/supervisor.js", "src/runtime/ports.js", "src/commands/runtime-supervisor.js"].filter(has),
      missing: ok ? [] : ["supervisor contínuo (restart/backoff/dependsOn) — hoje launch+readiness"],
    })
  }

  // 9. Secrets Broker (PRD 12 §10) — REAL: keychain do SO, sem .env.
  {
    const ok = cliHasCommand(read, "secrets") && has("src/secrets/broker.js") && has("src/secrets/providers.js") && has("tests/secrets.test.js")
    add({
      id: "secrets-broker", claim: "Secrets Broker (keychain do SO, sem .env)",
      status: ok ? "REAL" : "PARTIAL", severity: "P1",
      evidence: ["src/secrets/broker.js", "src/secrets/providers.js", "src/secrets/schema.js", "src/commands/secrets.js"].filter(has),
      missing: ok ? [] : ["providers por SO + comandos doctor/set/list/run"],
    })
  }

  // 10. Runtime Manifest V2 (PRD 12 PR3) — REAL: schema/migração/validação.
  add({
    id: "runtime-manifest", claim: "Runtime Manifest V2 (contrato do supervisor)",
    status: (has("src/runtime/manifest.js") && has("tests/runtime_manifest.test.js")) ? "REAL" : "PARTIAL",
    severity: "P2", evidence: ["src/runtime/manifest.js"].filter(has), missing: [],
  })

  // 11. Package Manager Doctor (PRD 12 PR2) — REAL: resolver + doctor --package-manager.
  add({
    id: "package-manager", claim: "Resolver de package manager (doctor --package-manager)",
    status: (has("src/installer/package-manager.js") && read("src/installer/doctor.js").includes("--package-manager")) ? "REAL" : "PARTIAL",
    severity: "P2", evidence: ["src/installer/package-manager.js"].filter(has), missing: [],
  })

  // 12. Contrato Full sem degradação (PRD 12 §11) — REAL: gate + --allow-degraded.
  add({
    id: "full-contract", claim: "Full = tudo (bloqueia degradação silenciosa)",
    status: (has("src/installer/full-contract.js") && read("src/installer/install.js").includes("allow-degraded")) ? "REAL" : "PARTIAL",
    severity: "P1", evidence: ["src/installer/full-contract.js"].filter(has), missing: [],
  })

  // 13. Agent Factory Contract (PRD 13 PR13.1) — REAL: fonte única → adapters, drift guard, Execution Contract.
  {
    const ok = cliHasCommand(read, "agents") && has("src/agents/factory.js") && has("tests/agents_factory.test.js") &&
      read("agents/generated/manifest.json").includes('"schemaVersion": 2')
    add({
      id: "agent-factory", claim: "Agent Factory (fonte única → adapters; drift guard + Execution Contract)",
      status: ok ? "REAL" : "PARTIAL", severity: "P1",
      evidence: ["src/agents/factory.js", "scripts/scripts/build_agents.js", "src/commands/agents.js"].filter(has),
      missing: ok ? [] : ["manifest v2 + drift guard + comando agents"],
    })
  }

  // 14. AgentShield Blocking Build (PRD 13 PR13.2) — REAL: scan determinístico bloqueia injeção em build E --check.
  {
    const ok = has("src/agents/scanner.js") && has("tests/agents_scanner.test.js") &&
      read("scripts/scripts/build_agents.js").includes("evaluateScan")
    add({
      id: "agentshield", claim: "AgentShield: scan determinístico bloqueia prompt-injection (build + --check)",
      status: ok ? "REAL" : "PARTIAL", severity: "P1",
      evidence: ["src/agents/scanner.js", "scripts/scripts/build_agents.js"].filter(has),
      missing: ok ? [] : ["scanner determinístico no build e no --check"],
    })
  }

  // 15. Adapter Capability Matrix honesta (PRD 13 PR13.3) — REAL: enforcement real por harness, sem Zero-Trust p/ instrucional.
  {
    const ok = has("src/agents/adapter-matrix.js") && has("tests/agents_adapter_matrix.test.js") && cliHasCommand(read, "agents")
    add({
      id: "adapter-matrix", claim: "Adapter matrix honesta (enforcement real; instrucional ≠ Zero-Trust)",
      status: ok ? "REAL" : "PARTIAL", severity: "P2",
      evidence: ["src/agents/adapter-matrix.js", "src/commands/agents.js"].filter(has),
      missing: ok ? [] : ["matriz de enforcement + copilot/gemini gerados"],
    })
  }

  // 16. QA Multi-Lens (PRD 12 B2) — REAL: lentes determinísticas sobre o diff (veredito sem LLM).
  {
    const ok = has("src/project-plan/qa-lenses.js") && has("tests/qa_lenses.test.js") && cliHasCommand(read, "qa")
    add({
      id: "qa-multi-lens", claim: "QA Multi-Lens determinístico (eval/any/secret/query/shell) sobre o diff",
      status: ok ? "REAL" : "PARTIAL", severity: "P1",
      evidence: ["src/project-plan/qa-lenses.js", "src/commands/qa.js"].filter(has),
      missing: ok ? ["Audit Agents sobre provenance chegam com a VFA (C1)"] : ["lentes determinísticas + comando qa"],
    })
  }

  // 17. VFA Provenance (PRD 13 PR13.4) — REAL: recibos com hash-chain; audit verify pega adulteração.
  {
    const ok = has("src/vfa/attestation.js") && has("src/vfa/provenance.js") &&
      has("tests/vfa_attestation.test.js") && cliHasCommand(read, "audit")
    add({
      id: "vfa-provenance", claim: "VFA: provenance hash-chain + attestation (audit verify pega adulteração)",
      status: ok ? "REAL" : "PARTIAL", severity: "P1",
      evidence: ["src/vfa/attestation.js", "src/vfa/provenance.js", "src/commands/audit.js"].filter(has),
      missing: ok ? ["challenge-response (C2) + auditores determinísticos sobre o log"] : ["attestation + provenance + audit"],
    })
  }

  // 18. Challenge-Response (PRD 13 PR13.5) — REAL: ação de alto risco exige evidência; instrucional=posthoc.
  {
    const ok = has("src/vfa/challenge.js") && has("tests/vfa_challenge.test.js") && cliHasCommand(read, "challenge")
    add({
      id: "challenge-response", claim: "Challenge-Response (alto risco exige backup/manifest/rollback; instrucional=posthoc_audit_only)",
      status: ok ? "REAL" : "PARTIAL", severity: "P1",
      evidence: ["src/vfa/challenge.js", "src/commands/challenge.js"].filter(has),
      missing: ok ? ["enforcement no pre-tool hook Python (refinamento)"] : ["classifier + challenge + deny"],
    })
  }

  // 19. Meta-Harness MVP (PRD 13 PR13.6) — REAL: executor+verifier independente, dupla verificação (QG decide).
  {
    const ok = has("src/meta/orchestrator.js") && has("tests/meta_orchestrator.test.js") && cliHasCommand(read, "orchestrate")
    add({
      id: "meta-harness", claim: "Meta-Harness (executor em worktree + verifier independente; QG decide, LLM advisory)",
      status: ok ? "REAL" : "PARTIAL", severity: "P1",
      evidence: ["src/meta/orchestrator.js", "src/commands/orchestrate.js"].filter(has),
      missing: ok ? ["reviewer LLM real plugável (hoje advisory no-op) + multi-harness paralelo"] : ["orchestrator + dupla verificação"],
    })
  }

  // 20. Type safety + coverage + bench (PRD 12 B3 / PR10) — REAL: .d.ts dos contratos + gate c8 ≥70% + bench.
  {
    const ok = has("types/contracts.d.ts") && has("jsconfig.json") && has("scripts/bench.mjs") && read("package.json").includes("coverage:ci")
    add({
      id: "type-coverage", claim: "Tipos dos contratos (.d.ts) + coverage gate c8 (≥70%) + benchmarks",
      status: ok ? "REAL" : "PARTIAL", severity: "P2",
      evidence: ["types/contracts.d.ts", "jsconfig.json", "scripts/bench.mjs"].filter(has),
      missing: ["gate `checkJs` full (adoção incremental de JSDoc nos options-bags)"],
    })
  }

  const summary = { REAL: 0, PARTIAL: 0, PLACEBO: 0, ROADMAP: 0, RISK: 0 }
  for (const c of claims) summary[c.status] = (summary[c.status] || 0) + 1
  return { generatedAt: new Date().toISOString(), root: ".", claims, summary }
}
