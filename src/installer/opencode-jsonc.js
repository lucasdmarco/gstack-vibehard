import { existsSync, readFileSync, renameSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { mergeJson } from "./merge.js"
import { versionedBackup, safeWriteFile } from "./safe-write.js"

/**
 * OpenCode "config is sacred" (PRD15 §7.8): a config do usuário é sagrada. O drift
 * `opencode.json` + `opencode.jsonc` NUNCA é consolidado automaticamente. O default
 * é diagnóstico READ-ONLY. Um merge só é oferecido quando o `.jsonc` NÃO contém
 * chaves sensíveis (provider/model/plugin/auth/oauth/…) e mesmo assim exige `--apply`
 * + confirmação. Renomear o `.jsonc` ativo é reversível via `--restore-jsonc`.
 *
 * Incidente que motivou a política: em máquina limpa, consolidar o `.jsonc` (com
 * OAuth/providers/models) quebrava o Desktop/OAuth do OpenCode e sumia com modelos.
 */

/** Chaves cuja presença no `.jsonc` torna o arquivo INTOCÁVEL (source of truth). */
export const OPENCODE_SENSITIVE_KEYS = Object.freeze([
  "provider", "providers", "model", "models", "plugin", "plugins",
  "auth", "oauth", "account", "token", "key", "credentials",
])

const DISABLED_SUFFIX = ".gstack-disabled"

/** Remove comentários // e /* *​/ (respeitando strings) e trailing commas. */
export function stripJsonc(text) {
  let out = ""
  let inStr = false, inSL = false, inML = false, esc = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1]
    if (inSL) { if (c === "\n") { inSL = false; out += c } continue }
    if (inML) { if (c === "*" && n === "/") { inML = false; i++ } continue }
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === "/" && n === "/") { inSL = true; i++; continue }
    if (c === "/" && n === "*") { inML = true; i++; continue }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text))
}

/** Chaves sensíveis presentes no objeto de config (case-insensitive, top-level). */
export function sensitiveKeysPresent(obj) {
  if (!obj || typeof obj !== "object") return []
  const lower = new Set(OPENCODE_SENSITIVE_KEYS)
  return Object.keys(obj).filter((k) => lower.has(k.toLowerCase()))
}

function ocPaths(home) {
  const dir = join(home, ".config", "opencode")
  return { jsonPath: join(dir, "opencode.json"), jsoncPath: join(dir, "opencode.jsonc") }
}

/**
 * Plano de correção (READ-ONLY, nunca altera o disco).
 * action:
 *  - "none":     sem conflito json+jsonc, nada a fazer;
 *  - "manual":   um dos arquivos não parseia — ajuste humano;
 *  - "preserve": conflito E o `.jsonc` tem chaves sensíveis → NÃO consolidar; o
 *                `.jsonc` continua source of truth (recomenda-se mover o `.json`);
 *  - "merge":    conflito E o `.jsonc` é seguro (sem chaves sensíveis) → merge
 *                pode ser OFERECIDO, mas só aplica com --apply + confirmação.
 */
export function planOpenCodeFix(home = homedir()) {
  const { jsonPath, jsoncPath } = ocPaths(home)
  const hasJson = existsSync(jsonPath), hasJsonc = existsSync(jsoncPath)
  if (!(hasJson && hasJsonc)) return { action: "none", jsonPath, jsoncPath, reason: "sem conflito json+jsonc" }

  let json = {}, jsonc = {}, parseError = null
  try { json = JSON.parse(readFileSync(jsonPath, "utf-8")) } catch (e) { parseError = `opencode.json: ${e.message}` }
  try { jsonc = parseJsonc(readFileSync(jsoncPath, "utf-8")) } catch (e) { parseError = `${parseError ? parseError + "; " : ""}opencode.jsonc: ${e.message}` }
  if (parseError) return { action: "manual", jsonPath, jsoncPath, parseError }

  const sensitive = sensitiveKeysPresent(jsonc)
  if (sensitive.length > 0) {
    // Config is sacred: o .jsonc guarda OAuth/provider/model/plugin → intocável.
    return {
      action: "preserve", jsonPath, jsoncPath, sensitiveKeys: sensitive,
      reason: `opencode.jsonc contém ${sensitive.join(", ")} — é a fonte de verdade; NÃO consolidar`,
    }
  }
  // mergeJson(a, b) → b vence em conflito. Queremos o USUÁRIO (jsonc) com prioridade.
  const merged = mergeJson(json, jsonc)
  return { action: "merge", jsonPath, jsoncPath, merged, userKeysPreserved: Object.keys(jsonc) }
}

/**
 * Restaura um `.jsonc.gstack-disabled` deixado por uma versão anterior do GStack.
 * NÃO apaga a config do usuário: se houver um `.jsonc` ativo, faz backup antes.
 * O `opencode.json` NÃO é removido aqui (decisão humana).
 */
export function restoreOpenCodeJsonc(home = homedir()) {
  const { jsoncPath } = ocPaths(home)
  const disabledPath = jsoncPath + DISABLED_SUFFIX
  if (!existsSync(disabledPath)) return { restored: false, reason: "sem .jsonc.gstack-disabled para restaurar", disabledPath }
  if (existsSync(jsoncPath)) versionedBackup(jsoncPath) // não sobrescreve o ativo sem backup
  renameSync(disabledPath, jsoncPath)
  return { restored: true, jsoncPath, from: disabledPath }
}

/**
 * Aplica o merge SÓ no caso "merge" (jsonc sem chaves sensíveis) e SÓ quando o
 * chamador confirmou (`apply: true`). "preserve"/"none"/"manual" NUNCA alteram o
 * disco. O rename do `.jsonc` (reversível via restoreOpenCodeJsonc) só ocorre aqui.
 */
export function applyOpenCodeFix(home = homedir(), opts = {}) {
  if (opts.restoreJsonc) return restoreOpenCodeJsonc(home)
  const plan = planOpenCodeFix(home)
  if (plan.action === "preserve") {
    return { applied: false, refused: true, ...plan, hint: "opencode.jsonc é fonte de verdade — mova o opencode.json manualmente se quiser" }
  }
  if (plan.action !== "merge") return { applied: false, ...plan }
  if (!opts.apply) return { applied: false, wouldMerge: true, ...plan, hint: "repita com --apply para consolidar (reversível via --restore-jsonc)" }
  versionedBackup(plan.jsoncPath)
  safeWriteFile(plan.jsonPath, JSON.stringify(plan.merged, null, 2) + "\n", { component: "opencode", removeOnUninstall: false })
  const disabledPath = plan.jsoncPath + DISABLED_SUFFIX
  renameSync(plan.jsoncPath, disabledPath) // preserva o .jsonc (reversível)
  return { applied: true, jsonPath: plan.jsonPath, jsoncPath: plan.jsoncPath, disabledPath }
}

/** Lê as chaves sensíveis do `.jsonc` (por nome). { keys, parseError }. */
function readJsoncSensitive(jsoncPath) {
  if (!existsSync(jsoncPath)) return { keys: [], parseError: null }
  try { return { keys: sensitiveKeysPresent(parseJsonc(readFileSync(jsoncPath, "utf-8"))), parseError: null } }
  catch (e) { return { keys: [], parseError: `opencode.jsonc: ${e.message}` } }
}

function shadowingRisk(conflict, sensitiveCount) {
  if (conflict && sensitiveCount > 0) return "high"
  return conflict ? "low" : "none"
}

/**
 * Diagnóstico READ-ONLY para `doctor --opencode --json`: config, chaves sensíveis
 * detectadas (por NOME, nunca valor), risco de shadowing e resíduo disabled.
 */
export function diagnoseOpenCode(home = homedir()) {
  const { jsonPath, jsoncPath } = ocPaths(home)
  const hasJson = existsSync(jsonPath), hasJsonc = existsSync(jsoncPath)
  const disabledPath = jsoncPath + DISABLED_SUFFIX
  const hasDisabled = existsSync(disabledPath)
  const { keys: jsoncSensitive, parseError } = readJsoncSensitive(jsoncPath)
  const conflict = hasJson && hasJsonc
  return {
    schemaVersion: "gstack.opencode.v1",
    jsonPath, jsoncPath, hasJson, hasJsonc, conflict,
    jsoncSensitiveKeys: jsoncSensitive, // só nomes
    shadowingRisk: shadowingRisk(conflict, jsoncSensitive.length),
    disabledResidue: hasDisabled ? disabledPath : null,
    recommendedAction: hasDisabled ? "restore-jsonc" : planOpenCodeFix(home).action,
    parseError,
  }
}
