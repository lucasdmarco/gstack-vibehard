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

  // 7. Loop Engineer task — PARTIAL: planeja, não executa o loop completo.
  add({
    id: "task-loop", claim: "Loop Engineer (task) executa features",
    status: cliHasCommand(read, "task") ? "PARTIAL" : "PLACEBO", severity: "P2",
    evidence: ["src/commands/task.js", "src/project-plan/task-planner.js"].filter(has),
    missing: ["execução do loop (worktree/diff/accept) — hoje só planeja"],
  })

  const summary = { REAL: 0, PARTIAL: 0, PLACEBO: 0, ROADMAP: 0, RISK: 0 }
  for (const c of claims) summary[c.status] = (summary[c.status] || 0) + 1
  return { generatedAt: new Date().toISOString(), root: ".", claims, summary }
}
