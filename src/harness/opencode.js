import { existsSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { writeWithBackup, ensureDir, readJsonFile, mergeJson } from "../installer/merge.js"
import { safeCopyFile } from "../installer/safe-write.js"
import { inspectOpenCodeConfig, shouldWriteOpenCodeJson } from "./opencode-config.js"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_SRC = join(__dirname, "..", "plugins", "opencode")

/**
 * Atualiza SÓ os plugins gerenciados do gstack (P2 da máquina limpa: harness
 * "já instalado" pulava o refresh e os plugins ficavam na versão antiga/ausentes).
 * MANIFEST-OWNED via safeCopyFile (backup de homônimo do usuário; uninstall
 * restaura). Idempotente — seguro chamar em TODO install/upgrade, como refreshHooks.
 * NUNCA toca opencode.json/.jsonc.
 */
export function refreshOpenCodePlugins(deps = {}, report) {
  const home = deps.home || HOME
  const pluginsDir = join(home, ".config", "opencode", "plugins")
  if (!existsSync(PLUGIN_SRC)) return 0
  ensureDir(pluginsDir)
  let copied = 0
  for (const file of ["gstack-security.js", "gstack-session.js", "gstack-prompt.js"]) {
    const src = join(PLUGIN_SRC, file)
    if (!existsSync(src)) continue
    safeCopyFile(src, join(pluginsDir, file), { home, component: "opencode-plugin" })
    report.updated.push(`~/.config/opencode/plugins/${file}`)
    copied += 1
  }
  return copied
}

/**
 * Integra o gstack ao OpenCode SEM sombrear a config do usuário.
 *
 * A doc oficial confirma que plugins (`~/.config/opencode/plugins/`) e skills
 * (`~/.config/opencode/skills/` e `~/.agents/skills/`) AUTO-CARREGAM sem entrada
 * no config. Por isso a integração é por DIRETÓRIO; só escrevemos `opencode.json`
 * quando ele já existe sozinho (merge não-destrutivo). Havendo `opencode.jsonc`
 * (sozinho ou junto), NÃO tocamos em config — preservamos OAuth/providers/plugins.
 *
 * @param {object} deps  { home? } — seam para testes herméticos.
 */
export async function installOpenCode(config, report, deps = {}) {
  const home = deps.home || HOME
  const configDir = join(home, ".config", "opencode")
  const skillsDir = join(configDir, "skills")
  const pluginsDir = join(configDir, "plugins")
  ensureDir(configDir)
  ensureDir(skillsDir)
  ensureDir(pluginsDir)

  // 1) Plugins SEMPRE (auto-load garantido pela doc — não depende de config).
  refreshOpenCodePlugins({ home }, report)

  // 2) Config: só escreve opencode.json quando é seguro (estratégia json_merge).
  const inspect = inspectOpenCodeConfig(home)
  for (const w of inspect.warnings) report.skipped.push(`opencode: ${w}`)

  if (config.hooks && shouldWriteOpenCodeJson(inspect)) writeOpenCodeJsonMerged(inspect, skillsDir, report)
  else if (config.hooks) {
    // jsonc presente (sozinho ou em conflito) ou nenhum config: integração por
    // diretórios auto-load; NÃO escrevemos config (preserva o que o usuário tem).
    report.skipped.push(
      `opencode: config não escrita (${inspect.preferredStrategy}) — integração via plugins/skills (auto-load)`
    )
  }

  return report
}

// Escreve opencode.json com MERGE não-destrutivo (prioridade do usuário em conflito).
function writeOpenCodeJsonMerged(inspect, skillsDir, report) {
  const gstackConfig = {
    $schema: "https://opencode.ai/config.json",
    // skills.paths é redundante (skills auto-carregam de ~/.agents/skills), mas
    // mantido aqui para usuários que já tinham opencode.json com nossa marca.
    skills: { paths: [skillsDir] },
    instructions: [
      "Comandos disponiveis:",
      "  /start      — PONTO DE ENTRADA guiado (objetivo -> plano -> execucao). Use primeiro.",
      "  /newproject — Guided Architecture Walkthrough (9 passos de arquitetura)",
      "  /g_update   — Atualizar gstack_vibehard para versao mais recente",
      "",
      "Se ~/.gstack_vibehard/update_status.json mostrar latest > local, avise e sugira /g_update",
      "",
      "Sempre rode Quality Gate (python ~/.gstack/hooks/qg.py ou ~/.codex/hooks/qg.py) antes de entregar output.",
    ],
  }
  const existing = readJsonFile(inspect.jsonPath)
  const merged = existing ? mergeJson(gstackConfig, existing) : gstackConfig
  writeWithBackup(inspect.jsonPath, JSON.stringify(merged, null, 2))
  report.updated.push("~/.config/opencode/opencode.json (merge)")
}
