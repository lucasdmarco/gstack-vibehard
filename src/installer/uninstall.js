import { existsSync, readdirSync, unlinkSync, renameSync, rmSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join, dirname, basename } from "path"
import { fileURLToPath } from "url"
import { getInstalledComponents, getInstalledScripts, getInstalledSkills } from "./check.js"
import { stripGstackFromCodexConfig } from "../harness/codex.js"
import { loadManifest, findItems } from "./manifest.js"
import { restoreBackupsFromManifest } from "./restore.js"
import { confirm, success, warn, error, info, section } from "../cli/index.js"

const HOME = homedir()

function getProjectRoot() {
  const __filename = fileURLToPath(import.meta.url)
  let dir = dirname(__filename)
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return dirname(__filename)
}

const PROJECT_ROOT = getProjectRoot()
const MANIFEST_PATH = join(HOME, ".gstack_vibehard", "install-manifest.json")

/**
 * Remove um arquivo instalado. Se houver backup .gstack_vibehard.bak do
 * arquivo original do usuario, restaura o backup no lugar.
 */
function removeWithRestore(filePath, report) {
  if (!existsSync(filePath)) return false
  const bak = filePath + ".gstack_vibehard.bak"
  try {
    unlinkSync(filePath)
    if (existsSync(bak)) {
      renameSync(bak, filePath)
      report.restored.push(filePath)
    } else {
      report.removed.push(filePath)
    }
    return true
  } catch (e) {
    report.errors.push(`${filePath}: ${e.message}`)
    return false
  }
}

function packageFileNames(subdir, extension) {
  const source = join(PROJECT_ROOT, subdir)
  if (!existsSync(source)) return []
  try {
    return readdirSync(source).filter((f) => f.endsWith(extension))
  } catch {
    return []
  }
}

function removeDir(dir, report) {
  if (!dir || !existsSync(dir)) return false
  try {
    rmSync(dir, { recursive: true, force: true })
    report.removed.push(dir)
    return true
  } catch (e) {
    report.errors.push(`${dir}: ${e.message}`)
    return false
  }
}

function removeHooks(report) {
  // Somente os nomes de hook que existem no pacote. Inclui a fonte canonica
  // ~/.gstack/hooks (criada pelo install Step 3) alem dos dirs por harness.
  const packageHooks = packageFileNames(join("hooks", "hooks"), ".py")
  const hookDirs = [
    join(HOME, ".gstack", "hooks"),
    join(HOME, ".codex", "hooks"),
    join(HOME, ".claude", "hooks"),
  ]
  for (const hooksDir of hookDirs) {
    if (!existsSync(hooksDir)) continue
    const count = packageHooks.filter((hook) => removeWithRestore(join(hooksDir, hook), report)).length
    if (count > 0) success(`${count} hooks removidos de ${hooksDir}`)
  }
}

/**
 * Remove os registros de hooks gstack do settings.json (Claude) e do
 * hooks.json (Cursor). Sem isso, o harness tenta executar .py ja deletados e
 * falha em todo turno apos a desinstalacao.
 */
const GSTACK_HOOK_SCRIPTS = ["pre_tool_use_security.py", "stop.py", "session_start.py", "user_prompt_submit.py"]
const mentionsGstack = (cmd) =>
  typeof cmd === "string" && (cmd.includes(".gstack") || GSTACK_HOOK_SCRIPTS.some((s) => cmd.includes(s)))
const entryCmds = (entry) => (entry?.hooks || []).map((h) => h?.command || "")
const claudeEntryKept = (entry) => !entryCmds(entry).some(mentionsGstack) // settings.json: entry.hooks[].command
const cursorEntryKept = (entry) => !mentionsGstack(entry?.command)       // hooks.json: entry.command

// Reescreve hooks.<event> in-place, preservando só as entradas que `keepEntry` aprova.
function pruneHooksConfig(hooks, keepEntry) {
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue
    const kept = entries.filter(keepEntry)
    if (kept.length > 0) hooks[event] = kept
    else delete hooks[event]
  }
}

// Remove os registros de hooks gstack de UM arquivo de config (Claude/Cursor).
function stripHookRegistry(file, keepEntry, label, report) {
  if (!existsSync(file)) return
  try {
    const cfg = JSON.parse(readFileSync(file, "utf-8"))
    if (!cfg.hooks || typeof cfg.hooks !== "object") return
    pruneHooksConfig(cfg.hooks, keepEntry)
    writeFileSync(file, JSON.stringify(cfg, null, 2))
    report.removed.push(`registro de hooks: ${label}`)
  } catch (e) {
    report.errors.push(`${basename(file)}: ${e.message}`)
  }
}

function unregisterHooks(report) {
  stripHookRegistry(join(HOME, ".claude", "settings.json"), claudeEntryKept, "~/.claude/settings.json", report)
  stripHookRegistry(join(HOME, ".cursor", "hooks.json"), cursorEntryKept, "~/.cursor/hooks.json", report)
}

function readManifest() {
  try {
    if (existsSync(MANIFEST_PATH)) return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"))
  } catch (e) {
    warn(`manifest ilegivel: ${e.message}`)
  }
  return null
}

function removeGeneratedAgents(report) {
  // Diretorios registrados no manifest + namespace conhecido
  const manifest = readManifest()
  const agentDirs = new Set(Object.values(manifest?.agentDirectories || {}))
  agentDirs.add(join(HOME, ".claude", "agents", "gstack-vibehard"))
  agentDirs.add(join(HOME, ".codex", "agents", "gstack-vibehard"))
  for (const dir of agentDirs) {
    if (removeDir(dir, report)) success(`agentes removidos: ${dir}`)
  }
}

function packageSkillNames() {
  const source = join(PROJECT_ROOT, "skills", "skills")
  if (!existsSync(source)) return []
  try {
    return readdirSync(source, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

function removeSkills(report, opts = {}) {
  // PREFERE o manifest (ownership): remove só skills que o manifest prova serem
  // nossas — nunca uma skill do usuário com nome colidente.
  const manifest = loadManifest(HOME)
  const skillItems = findItems(manifest, (x) => x.kind === "skill" && x.removeOnUninstall !== false)
  if (skillItems.length > 0) {
    const count = skillItems.filter((it) => removeDir(it.path, report)).length
    if (count > 0) success(`${count} skills removidas (via manifest) de ~/.agents/skills/`)
    return
  }
  // SEM manifest (instalação legada): remover por NOME pode apagar skill do usuário
  // com nome colidente. Só faz isso com opt-in explícito (--legacy-name-cleanup).
  const installedSkills = new Set(getInstalledSkills())
  const targets = packageSkillNames().filter((skill) => installedSkills.has(skill))
  if (targets.length === 0) return
  if (!opts.legacyAllowed) {
    warn(`Sem manifest: ${targets.length} skill(s) com nome do pacote seriam removidas POR NOME (risco de colisão com a sua).`)
    info("  Não removidas. Para limpar instalação legada por nome: `gstack_vibehard uninstall --legacy-name-cleanup`")
    report.skipped.push(`skills legadas por nome: ${targets.length} (use --legacy-name-cleanup)`)
    return
  }
  const count = targets.filter((skill) => removeDir(join(HOME, ".agents", "skills", skill), report)).length
  if (count > 0) success(`${count} skills removidas (legado, por nome) de ~/.agents/skills/`)
}

/**
 * Restaura backups registrados no manifest (versionado: usa item.backup exato).
 * Restaura sempre do backup MAIS ANTIGO disponível (o original do usuário).
 */
// Restore extraído p/ src/installer/restore.js (injetável por home; reusado pelo
// Clean-Machine Proof Pack). Aqui fixamos home = HOME.
function restoreFromManifest(report, opts = {}) {
  return restoreBackupsFromManifest(HOME, report, opts)
}

/** Monta o plano de rollback a partir do manifest (para --dry-run). */
function buildRollbackPlan() {
  const manifest = loadManifest(HOME)
  const restore = findItems(manifest, (x) => x.restoreOnUninstall && x.backup).map((x) => x.path)
  const remove = findItems(manifest, (x) => x.removeOnUninstall !== false && !x.restoreOnUninstall).map((x) => x.path)
  return { restore, remove, items: (manifest.items || []).length }
}

function removeScripts(report) {
  const packageScripts = [
    ...packageFileNames(join("scripts", "scripts"), ".ps1"),
    ...packageFileNames(join("scripts", "scripts"), ".sh"),
  ]
  const count = packageScripts.filter((script) => removeWithRestore(join(HOME, ".agents", "scripts", script), report)).length
  if (count > 0) success(`${count} scripts removidos de ~/.agents/scripts/`)
}

/**
 * Hermes: remove as skills gstack de ~/.hermes/skills e tira o bloco instrucional
 * do ~/.hermes/AGENTS.md (preservando conteúdo do usuário fora dos marcadores).
 * NÃO mexe nos registros `hermes mcp add` (vivem no config do Hermes; os MCP
 * servers apontam para deps globais preservadas).
 */
function removeHermesSkills(report) {
  const skillsDir = join(HOME, ".hermes", "skills")
  if (!existsSync(skillsDir)) return
  const count = packageSkillNames().filter((skill) => removeDir(join(skillsDir, skill), report)).length
  if (count > 0) success(`${count} skills gstack removidas de ~/.hermes/skills/`)
}

// Reescreve o AGENTS.md sem o bloco marcado (ou apaga se ficar vazio). Preserva o resto.
function writeStrippedAgents(agents, stripped, report) {
  if (stripped) { writeFileSync(agents, stripped + "\n"); report.removed.push("bloco gstack: ~/.hermes/AGENTS.md") }
  else { unlinkSync(agents); report.removed.push("~/.hermes/AGENTS.md") }
}
function stripHermesAgentsBlock(report) {
  const agents = join(HOME, ".hermes", "AGENTS.md")
  if (!existsSync(agents)) return
  try {
    const MARKER = "<!-- gstack_vibehard:instrucional -->"
    const content = readFileSync(agents, "utf-8")
    if (!content.includes(MARKER)) return
    const first = content.indexOf(MARKER)
    const last = content.lastIndexOf(MARKER) + MARKER.length
    writeStrippedAgents(agents, (content.slice(0, first) + content.slice(last)).trim(), report)
  } catch (e) {
    report.errors.push(`hermes AGENTS.md: ${e.message}`)
  }
}

function removeHermes(report) {
  removeHermesSkills(report)
  // Snippet de MCP que o gstack gera quando o config.yaml já existia (seguro remover).
  // NUNCA tocamos no ~/.hermes/config.yaml do usuário (pode tê-lo editado / VPS).
  const snippet = join(HOME, ".hermes", "gstack-mcp-servers.yaml")
  if (existsSync(snippet)) removeWithRestore(snippet, report)
  stripHermesAgentsBlock(report)
}

function parseUninstallFlags(args) {
  const has = (f) => args.includes(f)
  return {
    skipConfirm: has("--yes") || has("-y"),
    dryRun: has("--dry-run"),
    restoreOnly: has("--restore-only"),
    removeVault: has("--remove-vault"),
    removeDeps: has("--remove-deps"),
    includeProjects: has("--include-projects"),
    legacyNameCleanup: has("--legacy-name-cleanup"),
    resolveDrift: has("--resolve-drift"),
  }
}

// --dry-run: mostra o plano de rollback SEM tocar em nada.
function printDryRunPlan() {
  section("gstack_vibehard Uninstaller — DRY RUN (nada será alterado)")
  const plan = buildRollbackPlan()
  info(`Manifest: ${plan.items} item(ns) registrados`)
  info("Será RESTAURADO de backup:")
  plan.restore.forEach((p) => info(`  ~ ${p}`))
  if (plan.restore.length === 0) info("  (nenhum backup no manifest)")
  info("Será REMOVIDO (criado pelo gstack):")
  plan.remove.forEach((p) => info(`  - ${p}`))
  if (plan.remove.length === 0) info("  (nenhum item exclusivo no manifest — limpeza por padrão)")
  info("Será PRESERVADO: projetos criados, ~/gstack-vault (salvo --remove-vault), deps globais")
  info("Rode sem --dry-run para aplicar (com --yes em modo não-interativo).")
}

async function handleRestoreOnly(flags, report) {
  section("gstack_vibehard Uninstaller — RESTORE ONLY")
  if (!flags.skipConfirm) {
    const ok = await confirm("Restaurar todos os backups do manifest?", false)
    if (!ok) { info("Cancelado."); return report }
  }
  restoreFromManifest(report, { dryRun: false, resolveDrift: flags.resolveDrift })
  info(`Restaurados de backup: ${report.restored.length}`)
  if (report.errors.length) report.errors.forEach((e) => warn(`  ${e}`))
  success("Restore concluido.")
  return report
}

function printUninstallIntro() {
  section("gstack_vibehard Uninstaller")
  info("Sera removido apenas o que o instalador criou (backups .bak sao restaurados):")
  info("  • hooks Python em ~/.gstack/hooks, ~/.codex/hooks e ~/.claude/hooks")
  info("  • registros de hooks em ~/.claude/settings.json e ~/.cursor/hooks.json")
  info("  • ~/.claude/rules/ultracode.md e ~/CLAUDE.md (restaura backup)")
  info("  • agentes gerados (namespace gstack-vibehard)")
  info("  • skills e scripts em ~/.agents instalados pelo pacote")
  info("  • skills gstack + bloco instrucional em ~/.hermes (Hermes)")
  info("  • manifest ~/.gstack_vibehard/")
  info("Nao remove: deps globais (bun, uv, Rust, headroom), ~/gstack-vault, ~/.mcp.json")
}

// Codex config.toml: remove apenas as chaves gstack, preservando a config do usuario.
function removeCodexKeys(report) {
  try {
    const codexConfig = join(HOME, ".codex", "config.toml")
    if (existsSync(codexConfig) && stripGstackFromCodexConfig(codexConfig)) {
      report.removed.push("chaves gstack: ~/.codex/config.toml")
    }
  } catch (e) {
    report.errors.push(`config.toml: ${e.message}`)
  }
}

// RESTAURA os originais (manifest) e remove o que o instalador criou.
function removeInstalledArtifacts(flags, report) {
  restoreFromManifest(report, { resolveDrift: flags.resolveDrift })
  unregisterHooks(report)
  removeHooks(report)
  removeCodexKeys(report)
  removeWithRestore(join(HOME, ".claude", "rules", "ultracode.md"), report)
  removeWithRestore(join(HOME, "CLAUDE.md"), report)
  removeGeneratedAgents(report)
  removeSkills(report, { legacyAllowed: flags.legacyNameCleanup })
  removeScripts(report)
  removeHermes(report)
  removeWithRestore(join(HOME, "gstack_vibehard-install.bat"), report)
  removeWithRestore(join(HOME, "gstack_vibehard-install.sh"), report)
  removeDir(join(HOME, ".gstack_vibehard"), report)
}

function handleOptionalFlags(flags, report) {
  if (flags.removeVault) {
    removeDir(join(HOME, "gstack-vault"), report)
    success("~/gstack-vault removido (--remove-vault)")
  } else {
    report.skipped.push("~/gstack-vault preservado (use --remove-vault para remover)")
  }
  if (flags.removeDeps) {
    warn("--remove-deps: remoção de deps globais (bun/uv/Rust/headroom) NÃO é automatizada por segurança.")
    info("  Remova manualmente o que não usar mais. O gstack não desinstala binários globais.")
  }
  if (flags.includeProjects) {
    warn("--include-projects: o uninstall global NÃO apaga projetos criados.")
    info("  Para remover a integração de um projeto, rode dentro dele (escopo separado).")
  }
}

function printUninstallReport(report) {
  section("Relatorio da Remocao")
  info(`Removidos: ${report.removed.length}`)
  if (report.restored.length > 0) info(`Restaurados de backup: ${report.restored.length}`)
  if (report.errors.length > 0) {
    error(`Erros: ${report.errors.length}`)
    report.errors.forEach((e) => warn(`  ${e}`))
  }
  info("Vault (~/gstack-vault) e deps globais foram preservados intencionalmente.")
  success("Remocao concluida.")
}

async function confirmUninstall(flags) {
  if (flags.skipConfirm) return true
  return confirm("Continuar com a remocao?", false)
}

export async function uninstall(args = []) {
  const flags = parseUninstallFlags(args)
  const report = { removed: [], restored: [], skipped: [], errors: [] }

  if (flags.dryRun) { printDryRunPlan(); return report }
  // Sem TTY e sem --yes: abortar — remocao silenciosa sem consentimento e inaceitavel.
  if (!process.stdin.isTTY && !flags.skipConfirm) {
    error("Modo nao-interativo: confirme explicitamente com --yes")
    info("  gstack_vibehard uninstall --yes")
    return report
  }
  if (flags.restoreOnly) return handleRestoreOnly(flags, report)

  printUninstallIntro()
  if (!(await confirmUninstall(flags))) { info("Remocao cancelada."); return report }

  removeInstalledArtifacts(flags, report)
  handleOptionalFlags(flags, report)
  printUninstallReport(report)
  return report
}

function listComponents() {
  section("Componentes gstack_vibehard instalados")
  for (const [harnessId, comps] of Object.entries(getInstalledComponents())) {
    info(`${harnessId}:`)
    for (const comp of comps) {
      if (comp.present) success(`  ${comp.label}`)
      else info(`  ${comp.label} — ausente`)
    }
  }
}

function listSkills() {
  const skills = getInstalledSkills()
  info("")
  info(`Skills (~/.agents/skills): ${skills.length}`)
  for (const s of skills.slice(0, 20)) info(`  • ${s}`)
  if (skills.length > 20) info(`  ... e mais ${skills.length - 20}`)
}

function listScripts() {
  const scripts = getInstalledScripts()
  info("")
  info(`Scripts (~/.agents/scripts): ${scripts.length}`)
  for (const s of scripts) info(`  • ${s}`)
}

function listManifest() {
  info("")
  if (!existsSync(MANIFEST_PATH)) { info("Manifest: nao encontrado (instalacao antiga ou nunca instalado)"); return }
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"))
    info(`Manifest: ${MANIFEST_PATH}`)
    info(`  Instalado em: ${manifest.installedAt || "desconhecido"}`)
    for (const [id, dir] of Object.entries(manifest.agentDirectories || {})) info(`  agentes ${id}: ${dir}`)
  } catch (e) {
    warn(`manifest ilegivel: ${e.message}`)
  }
}

export async function list() {
  listComponents()
  listSkills()
  listScripts()
  listManifest()
}
