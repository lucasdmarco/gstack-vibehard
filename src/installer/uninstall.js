import { existsSync, readdirSync, unlinkSync, renameSync, rmSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { getInstalledComponents, getInstalledScripts, getInstalledSkills } from "./check.js"
import { stripGstackFromCodexConfig } from "../harness/codex.js"
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
function unregisterHooks(report) {
  const GSTACK_SCRIPTS = [
    "pre_tool_use_security.py", "stop.py", "session_start.py", "user_prompt_submit.py",
  ]
  const mentionsGstack = (cmd) =>
    typeof cmd === "string" && (cmd.includes(".gstack") || GSTACK_SCRIPTS.some((s) => cmd.includes(s)))

  // Claude: settings.json -> hooks.<Evento>[].hooks[].command
  const claudeSettings = join(HOME, ".claude", "settings.json")
  if (existsSync(claudeSettings)) {
    try {
      const settings = JSON.parse(readFileSync(claudeSettings, "utf-8"))
      if (settings.hooks && typeof settings.hooks === "object") {
        for (const [event, entries] of Object.entries(settings.hooks)) {
          if (!Array.isArray(entries)) continue
          const kept = entries.filter((entry) => {
            const cmds = (entry?.hooks || []).map((h) => h?.command || "")
            return !cmds.some(mentionsGstack)
          })
          if (kept.length > 0) settings.hooks[event] = kept
          else delete settings.hooks[event]
        }
        writeFileSync(claudeSettings, JSON.stringify(settings, null, 2))
        report.removed.push("registro de hooks: ~/.claude/settings.json")
      }
    } catch (e) {
      report.errors.push(`settings.json: ${e.message}`)
    }
  }

  // Cursor: hooks.json -> hooks.<evento>[].command
  const cursorHooks = join(HOME, ".cursor", "hooks.json")
  if (existsSync(cursorHooks)) {
    try {
      const config = JSON.parse(readFileSync(cursorHooks, "utf-8"))
      if (config.hooks && typeof config.hooks === "object") {
        for (const [event, entries] of Object.entries(config.hooks)) {
          if (!Array.isArray(entries)) continue
          const kept = entries.filter((entry) => !mentionsGstack(entry?.command))
          if (kept.length > 0) config.hooks[event] = kept
          else delete config.hooks[event]
        }
        writeFileSync(cursorHooks, JSON.stringify(config, null, 2))
        report.removed.push("registro de hooks: ~/.cursor/hooks.json")
      }
    } catch (e) {
      report.errors.push(`hooks.json: ${e.message}`)
    }
  }
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

function removeSkills(report) {
  // Somente skills que existem no pacote E estao instaladas
  const installedSkills = new Set(getInstalledSkills())
  const targets = packageSkillNames().filter((skill) => installedSkills.has(skill))
  const count = targets.filter((skill) => removeDir(join(HOME, ".agents", "skills", skill), report)).length
  if (count > 0) success(`${count} skills removidas de ~/.agents/skills/`)
}

function removeScripts(report) {
  const packageScripts = [
    ...packageFileNames(join("scripts", "scripts"), ".ps1"),
    ...packageFileNames(join("scripts", "scripts"), ".sh"),
  ]
  const count = packageScripts.filter((script) => removeWithRestore(join(HOME, ".agents", "scripts", script), report)).length
  if (count > 0) success(`${count} scripts removidos de ~/.agents/scripts/`)
}

export async function uninstall(args = []) {
  const hasYesFlag = args.includes("--yes") || args.includes("-y")
  const report = { removed: [], restored: [], skipped: [], errors: [] }

  // Sem TTY e sem --yes: abortar — remocao silenciosa sem consentimento e inaceitavel
  if (!process.stdin.isTTY && !hasYesFlag) {
    error("Modo nao-interativo: confirme explicitamente com --yes")
    info("  gstack_vibehard uninstall --yes")
    return report
  }
  const skipConfirm = hasYesFlag

  section("gstack_vibehard Uninstaller")
  info("Sera removido apenas o que o instalador criou (backups .bak sao restaurados):")
  info("  • hooks Python em ~/.gstack/hooks, ~/.codex/hooks e ~/.claude/hooks")
  info("  • registros de hooks em ~/.claude/settings.json e ~/.cursor/hooks.json")
  info("  • ~/.claude/rules/ultracode.md e ~/CLAUDE.md (restaura backup)")
  info("  • agentes gerados (namespace gstack-vibehard)")
  info("  • skills e scripts em ~/.agents instalados pelo pacote")
  info("  • manifest ~/.gstack_vibehard/")
  info("Nao remove: deps globais (bun, uv, Rust, headroom), ~/gstack-vault, ~/.mcp.json")

  if (!skipConfirm) {
    const ok = await confirm("Continuar com a remocao?", false)
    if (!ok) {
      info("Remocao cancelada.")
      return report
    }
  }

  unregisterHooks(report)
  removeHooks(report)
  // Codex config.toml: remove apenas as chaves gstack, preservando a config do usuario
  try {
    const codexConfig = join(HOME, ".codex", "config.toml")
    if (existsSync(codexConfig) && stripGstackFromCodexConfig(codexConfig)) {
      report.removed.push("chaves gstack: ~/.codex/config.toml")
    }
  } catch (e) {
    report.errors.push(`config.toml: ${e.message}`)
  }
  removeWithRestore(join(HOME, ".claude", "rules", "ultracode.md"), report)
  removeWithRestore(join(HOME, "CLAUDE.md"), report)
  removeGeneratedAgents(report)
  removeSkills(report)
  removeScripts(report)
  removeWithRestore(join(HOME, "gstack_vibehard-install.bat"), report)
  removeWithRestore(join(HOME, "gstack_vibehard-install.sh"), report)
  removeDir(join(HOME, ".gstack_vibehard"), report)

  section("Relatorio da Remocao")
  info(`Removidos: ${report.removed.length}`)
  if (report.restored.length > 0) info(`Restaurados de backup: ${report.restored.length}`)
  if (report.errors.length > 0) {
    error(`Erros: ${report.errors.length}`)
    report.errors.forEach((e) => warn(`  ${e}`))
  }
  info("Vault (~/gstack-vault) e deps globais foram preservados intencionalmente.")
  success("Remocao concluida.")
  return report
}

export async function list() {
  section("Componentes gstack_vibehard instalados")

  const components = getInstalledComponents()
  for (const [harnessId, comps] of Object.entries(components)) {
    info(`${harnessId}:`)
    for (const comp of comps) {
      if (comp.present) success(`  ${comp.label}`)
      else info(`  ${comp.label} — ausente`)
    }
  }

  const skills = getInstalledSkills()
  info("")
  info(`Skills (~/.agents/skills): ${skills.length}`)
  for (const s of skills.slice(0, 20)) info(`  • ${s}`)
  if (skills.length > 20) info(`  ... e mais ${skills.length - 20}`)

  const scripts = getInstalledScripts()
  info("")
  info(`Scripts (~/.agents/scripts): ${scripts.length}`)
  for (const s of scripts) info(`  • ${s}`)

  if (existsSync(MANIFEST_PATH)) {
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"))
      info("")
      info(`Manifest: ${MANIFEST_PATH}`)
      info(`  Instalado em: ${manifest.installedAt || "desconhecido"}`)
      for (const [id, dir] of Object.entries(manifest.agentDirectories || {})) {
        info(`  agentes ${id}: ${dir}`)
      }
    } catch (e) {
      warn(`manifest ilegivel: ${e.message}`)
    }
  } else {
    info("")
    info("Manifest: nao encontrado (instalacao antiga ou nunca instalado)")
  }
}
