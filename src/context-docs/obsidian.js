import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir, platform } from "os"

/**
 * Obsidian como fonte do Document Graph — OPT-IN e READ-ONLY.
 *
 * INVARIANTE DE SEGURANÇA: detectar ≠ indexar. A detecção lê apenas o
 * obsidian.json (config: existência + paths dos vaults), NUNCA o conteúdo das
 * notas. A indexação (ler os .md) só ocorre da pasta que o usuário escolheu
 * explicitamente. "Pular" → nada é lido. Nunca o app é aberto, nem cofre criado.
 */

const HOME = homedir()
const GLOBAL_DEFAULTS = join(HOME, ".gstack", "context-defaults.json")

function contextPath(cwd) {
  return join(cwd, ".gstack", "context.json")
}
function readJson(p) {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null } catch { return null }
}

// ── Detecção (lê SÓ o obsidian.json de config) ───────────────────────────────
function obsidianConfigDir() {
  if (platform() === "win32") return join(process.env.APPDATA || join(HOME, "AppData", "Roaming"), "obsidian")
  if (platform() === "darwin") return join(HOME, "Library", "Application Support", "obsidian")
  return join(HOME, ".config", "obsidian")
}

/** Retorna [{path, open}] dos vaults do obsidian.json. Nunca lê conteúdo. */
export function detectObsidianVaults(configDir = obsidianConfigDir()) {
  const cfg = readJson(join(configDir, "obsidian.json"))
  const vaults = cfg?.vaults
  if (!vaults || typeof vaults !== "object") return []
  return Object.values(vaults)
    .filter((v) => v && typeof v.path === "string")
    .map((v) => ({ path: v.path, open: Boolean(v.open) }))
}

/** True se o Obsidian aparenta estar instalado (config existe ou há vaults). */
export function obsidianDetected(configDir = obsidianConfigDir()) {
  return existsSync(configDir) || detectObsidianVaults(configDir).length > 0
}

// ── Default global (projetos herdam) ─────────────────────────────────────────
export function getGlobalObsidianDefault() {
  return readJson(GLOBAL_DEFAULTS)?.obsidianPath || null
}
export function setGlobalObsidianDefault(folder) {
  mkdirSync(dirname(GLOBAL_DEFAULTS), { recursive: true })
  const cur = readJson(GLOBAL_DEFAULTS) || {}
  cur.obsidianPath = folder
  writeFileSync(GLOBAL_DEFAULTS, JSON.stringify(cur, null, 2) + "\n")
  return folder
}

// ── Config por projeto (.gstack/context.json) ────────────────────────────────
export function setObsidianPath(cwd, folder) {
  const p = contextPath(cwd)
  mkdirSync(dirname(p), { recursive: true })
  const reg = readJson(p) || { schemaVersion: 1, sources: {}, sessionStart: { injectMode: "summary-only" } }
  reg.obsidian = { path: folder }
  writeFileSync(p, JSON.stringify(reg, null, 2) + "\n")
  return reg.obsidian
}

/** Caminho efetivo: projeto > default global. */
export function getObsidianPath(cwd) {
  return readJson(contextPath(cwd))?.obsidian?.path || getGlobalObsidianDefault() || null
}

/** Opções para o prompt de escolha (vaults + gstack-vault + outra + pular). */
export function buildObsidianChoices(configDir = obsidianConfigDir()) {
  const choices = detectObsidianVaults(configDir).map((v) => ({ label: `Vault: ${v.path}`, value: v.path }))
  const gv = join(HOME, "gstack-vault")
  if (existsSync(gv)) choices.push({ label: `gstack-vault: ${gv}`, value: gv })
  choices.push({ label: "Outra pasta (digitar caminho)", value: "__other__" })
  choices.push({ label: "Pular por enquanto", value: "__skip__" })
  return choices
}

/**
 * Orquestra a ESCOLHA OBRIGATÓRIA (com 'pular'). UI injetada (select/prompt)
 * para manter este módulo sem acoplamento e testável. Retorna a pasta escolhida
 * ou null (pular). NÃO indexa nada — só decide o caminho.
 */
export async function chooseObsidian({ select, prompt }, configDir = obsidianConfigDir()) {
  const choices = buildObsidianChoices(configDir)
  const chosenLabel = await select(
    "Obsidian detectado — escolha uma pasta para indexar (read-only, só leitura):",
    choices.map((c) => c.label))
  const chosen = choices.find((c) => c.label === chosenLabel)?.value
  if (!chosen || chosen === "__skip__") return null
  if (chosen === "__other__") {
    const p = (await prompt("Caminho da pasta Obsidian:")).trim()
    return p || null
  }
  return chosen
}
