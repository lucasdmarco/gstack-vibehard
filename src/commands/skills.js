import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { buildSkillCatalog, skillsDoctor, renderCatalogMarkdown } from "../skills/catalog.js"
import { section, success, warn, info } from "../cli/index.js"

/**
 * `gstack_vibehard skills <catalog|doctor>` (PRD29 Sprint 29.0).
 *
 * KNOWLEDGE layer: nunca edita código-fonte. `catalog` grava só os artefatos
 * project-scoped `.gstack/skills/catalog.{json,md}` (mesmo padrão do context
 * index). `--json` = payload puro no stdout, zero banner.
 */

function writeCatalogArtifacts(cwd, catalog) {
  const dir = join(cwd, ".gstack", "skills")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n")
  writeFileSync(join(dir, "catalog.md"), renderCatalogMarkdown(catalog))
  return dir
}

function renderCatalogHuman(catalog, dir) {
  section(`skills catalog — ${catalog.totalSkills} skills (medido, determinístico)`)
  for (const [pack, n] of Object.entries(catalog.byPack)) info(`  • ${pack}: ${n}`)
  if (catalog.missingFrontmatter > 0) warn(`  ⚠ ${catalog.missingFrontmatter} sem frontmatter (veja skills doctor)`)
  success(`Catálogo: ${dir}\\catalog.json (+ catalog.md)`)
}

function catalogCmd(cwd, json) {
  const catalog = buildSkillCatalog({ root: cwd })
  const dir = writeCatalogArtifacts(cwd, catalog)
  if (json) { process.stdout.write(JSON.stringify(catalog) + "\n"); return catalog }
  renderCatalogHuman(catalog, dir)
  return catalog
}

const sevIcon = (s) => (s === "problem" ? "✗" : s === "warning" ? "⚠" : "•")
function renderDoctorHuman(report) {
  section(`skills doctor — ${report.totalSkills} skills`)
  if (report.findings.length === 0) { success("Nenhum achado — catálogo saudável."); return }
  for (const f of report.findings) {
    warn(`  ${sevIcon(f.severity)} ${f.id} (${f.severity}): ${f.paths.length} skill(s)`)
    f.paths.slice(0, 3).forEach((p) => info(`      ${p}`))
    if (f.paths.length > 3) info(`      … +${f.paths.length - 3}`)
  }
}

function doctorCmd(cwd, json, strict) {
  const report = skillsDoctor(buildSkillCatalog({ root: cwd }))
  const failed = strict ? !report.ok || report.findings.some((f) => f.severity === "warning") : !report.ok
  if (json) process.stdout.write(JSON.stringify(report) + "\n")
  else renderDoctorHuman(report)
  if (failed) process.exitCode = 1
  return report
}

function printUsage() {
  section("skills")
  info("  skills catalog [--json]            inventário determinístico (hash/provenance/fase)")
  info("  skills doctor [--json] [--strict]  saúde do catálogo (frontmatter/duplicatas/risco)")
}

/** Dispatcher do `skills`. */
export async function skillsCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  if (sub === "catalog") return catalogCmd(cwd, json)
  if (sub === "doctor") return doctorCmd(cwd, json, args.includes("--strict"))
  printUsage()
}
