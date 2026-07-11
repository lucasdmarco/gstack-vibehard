import { spawnSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join, dirname, resolve } from "path"
import { fileURLToPath } from "url"

/**
 * Onboarding Executor determinístico (PRD36 36.6). O `project-init` era uma skill
 * INSTRUCIONAL: o LLM lia o markdown e IMPROVISAVA quando um script falhava — o
 * transcript de campo reportou *"gstack instalado com sucesso"* DEPOIS de o script
 * falhar e a config ser feita à mão. Aqui o fluxo é: perguntar (na skill) →
 * EXECUTAR o setup → VERIFICAR o artefato → declarar o status HONESTO:
 *
 *   installed  script exit 0 E artefato(s) presente(s) (gstack: campos provados)
 *   degraded   artefato existe mas o script falhou/config incompleta (fallback) — NUNCA "sucesso"
 *   failed     artefato ausente (não instalou, ponto)
 *   skipped    não foi escolhido
 *
 * PURO/testável: io injetável (runScript/exists/readJson). Sem io, roda os
 * setup-*.ps1/.sh reais (os mesmos corrigidos no S0).
 */

export const ONBOARDING_SCHEMA = "gstack.onboarding.v1"
export const ONBOARDING_TOOLS = Object.freeze(["gstack", "gbrain", "context7", "superpowers", "graphify"])
export const ONBOARDING_STATUS = Object.freeze(["installed", "degraded", "failed", "skipped"])

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCRIPTS_DIR = join(PACKAGE_ROOT, "scripts", "scripts")

// Artefato(s) que provam a instalação de cada ferramenta (lição S0: marcador não basta).
function requiredArtifacts(tool, platform) {
  const runScript = platform === "win32" ? "scripts/run.ps1" : "scripts/run.sh"
  return {
    gstack: [".gstack/config.json"],
    gbrain: [".gbrain/context.json"],
    context7: [".context7/stack.json", ".context7/AGENTS.md"],
    superpowers: [runScript],
    graphify: [".graphify/deps.json"],
  }[tool] || []
}

const scriptName = (tool, platform) => `setup-${tool}.${platform === "win32" ? "ps1" : "sh"}`

// gstack só é "installed" com os campos realmente escritos (não config a meio).
function gstackConfigOk(projectDir, io) {
  const cfg = io.readJson(join(projectDir, ".gstack", "config.json"))
  return Boolean(cfg && cfg.variant && cfg.api_dir && cfg.db_package)
}

function defaultRunScript({ script, args }) {
  const abs = join(SCRIPTS_DIR, script)
  const isPs = script.endsWith(".ps1")
  const cmd = isPs ? "powershell.exe" : "bash"
  const argv = isPs ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", abs, ...args] : [abs, ...args]
  const res = spawnSync(cmd, argv, { encoding: "utf-8", timeout: 60000 })
  return { exitCode: res.status ?? 1, stderr: res.stderr || "" }
}

const defaultIo = Object.freeze({
  runScript: defaultRunScript,
  exists: existsSync,
  readJson: (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } },
})

// Argumentos do setup por ferramenta (gstack recebe a variante).
function scriptArgs(tool, projectDir, variant, platform) {
  const dirFlag = platform === "win32" ? ["-ProjectDir", projectDir] : [projectDir]
  if (tool === "gstack") return platform === "win32" ? [...dirFlag, "-Variant", variant] : [...dirFlag, variant]
  return dirFlag
}

// Decide o status honesto a partir do exit + presença de artefato + config.
function classifyResult({ tool, exitCode, artifacts, projectDir, io }) {
  const present = artifacts.every((a) => a.present)
  if (!present) return "failed"
  if (exitCode !== 0) return "degraded"
  if (tool === "gstack" && !gstackConfigOk(projectDir, io)) return "degraded"
  return "installed"
}

/** Executa UMA ferramenta: roda o setup e VERIFICA o artefato. */
function runTool(tool, { projectDir, variant, platform, io }) {
  const { exitCode } = io.runScript({ script: scriptName(tool, platform), args: scriptArgs(tool, projectDir, variant, platform) })
  const artifacts = requiredArtifacts(tool, platform).map((rel) => ({ path: rel, present: io.exists(join(projectDir, rel)) }))
  const status = classifyResult({ tool, exitCode, artifacts, projectDir, io })
  return { tool, status, scriptExit: exitCode, artifacts }
}

/**
 * Executa o onboarding das ferramentas escolhidas. `ok` só é true se NENHUMA
 * ferramenta escolhida falhou (failed) nem ficou degraded — sucesso exige prova.
 */
export function runOnboarding({ projectDir, tools = [], variant = "express", platform = process.platform, io = defaultIo } = {}) {
  const chosen = tools.filter((t) => ONBOARDING_TOOLS.includes(t))
  const results = ONBOARDING_TOOLS.map((tool) =>
    chosen.includes(tool) ? runTool(tool, { projectDir, variant, platform, io }) : { tool, status: "skipped", scriptExit: null, artifacts: [] },
  )
  const counts = { installed: 0, degraded: 0, failed: 0, skipped: 0 }
  for (const r of results) counts[r.status]++
  return {
    schemaVersion: ONBOARDING_SCHEMA,
    generatedAt: new Date().toISOString(),
    projectDir, variant,
    results, counts,
    ok: counts.failed === 0 && counts.degraded === 0 && counts.installed > 0,
    note: "installed exige artefato verificado; fallback/config incompleta = degraded (nunca 'sucesso'); artefato ausente = failed.",
  }
}

const STATUS_ICON = Object.freeze({ installed: "✓", degraded: "⚠", failed: "✗", skipped: "—" })

/** Render markdown do resultado (honesto por ferramenta). */
export function renderOnboardingMarkdown(report) {
  const lines = [
    `# Onboarding — ${report.projectDir} (variante ${report.variant})`, "",
    `installed ${report.counts.installed} · degraded ${report.counts.degraded} · failed ${report.counts.failed} · skipped ${report.counts.skipped}`, "",
    "| Ferramenta | Status | Artefatos |", "|---|---|---|",
  ]
  for (const r of report.results) {
    const arts = r.artifacts.map((a) => `${a.present ? "✓" : "✗"} ${a.path}`).join("<br>") || "—"
    lines.push(`| ${r.tool} | ${STATUS_ICON[r.status]} ${r.status} | ${arts} |`)
  }
  lines.push("", report.note, "")
  return lines.join("\n")
}
