import { mkdirSync, writeFileSync } from "fs"
import { isAbsolute, join } from "path"
import { runOnboarding, renderOnboardingMarkdown, ONBOARDING_TOOLS } from "../skills/onboarding.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `gstack_vibehard onboarding run` (PRD36 36.6). EXECUTION layer: roda os
 * setup-*.ps1/.sh das ferramentas escolhidas e VERIFICA os artefatos — o
 * executor determinístico que substitui o improviso instrucional do project-init.
 */

const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

function writeReport(cwd, report) {
  const dir = join(cwd, ".gstack", "onboarding")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n")
  writeFileSync(join(dir, "report.md"), renderOnboardingMarkdown(report))
}

const statusIcon = (s) => ({ installed: "✓", degraded: "⚠", failed: "✗", skipped: "—" }[s] || "?")

function renderHuman(report) {
  section(`onboarding — ${report.projectDir} (variante ${report.variant})`)
  for (const r of report.results.filter((x) => x.status !== "skipped")) {
    const arts = r.artifacts.map((a) => `${a.present ? "✓" : "✗"} ${a.path}`).join(", ")
    info(`  ${statusIcon(r.status)} ${r.tool}: ${r.status}${arts ? ` — ${arts}` : ""}`)
  }
  const c = report.counts
  if (report.ok) success(`Onboarding OK: ${c.installed} instalada(s), artefatos verificados.`)
  else error(`Onboarding NÃO está pronto: ${c.failed} falhou, ${c.degraded} degraded — nunca declare "sucesso".`)
}

function parseTools(args) {
  const raw = flagValue(args, "--tools")
  if (!raw || raw === "all") return [...ONBOARDING_TOOLS]
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

function emitRun(report, json) {
  if (json) process.stdout.write(JSON.stringify(report) + "\n")
  else renderHuman(report)
  if (!report.ok) process.exitCode = 1
  return report
}

function runCmd(cwd, args, json) {
  const dir = flagValue(args, "--dir") || cwd
  const projectDir = isAbsolute(dir) ? dir : join(cwd, dir)
  const report = runOnboarding({ projectDir, tools: parseTools(args), variant: flagValue(args, "--variant") || "express" })
  writeReport(cwd, report)
  return emitRun(report, json)
}

function printUsage() {
  section("onboarding")
  info("  onboarding run [--dir <d>] [--tools gstack,gbrain,...|all] [--variant express|fastify|hono] [--json]")
  warn("  executa os setup-*.ps1/.sh e VERIFICA os artefatos — installed só com prova; fallback = degraded.")
}

const SUBCOMMANDS = Object.freeze({ run: (cwd, args, json) => runCmd(cwd, args, json) })

export async function onboardingCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json)
  return printUsage()
}
