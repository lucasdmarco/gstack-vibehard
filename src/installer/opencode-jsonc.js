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

// Scanner JSONC: um passo por caractere; muta `st` e devolve o texto a emitir. Em
// aberturas de comentário / `*​/`, marca `st.skip` para consumir o próximo char.
function scanSingleLine(st, c) {
  if (c === "\n") { st.inSL = false; return c }
  return ""
}
function scanMultiLine(st, c, n) {
  if (c === "*" && n === "/") { st.inML = false; st.skip = true }
  return ""
}
function scanInString(st, c) {
  if (st.esc) st.esc = false
  else if (c === "\\") st.esc = true
  else if (c === '"') st.inStr = false
  return c
}
function scanDefault(st, c, n) {
  if (c === '"') { st.inStr = true; return c }
  if (c === "/" && n === "/") { st.inSL = true; st.skip = true; return "" }
  if (c === "/" && n === "*") { st.inML = true; st.skip = true; return "" }
  return c
}
function scanChar(st, c, n) {
  if (st.inSL) return scanSingleLine(st, c)
  if (st.inML) return scanMultiLine(st, c, n)
  if (st.inStr) return scanInString(st, c)
  return scanDefault(st, c, n)
}
/** Remove comentários // e /* *​/ (respeitando strings) e trailing commas. */
export function stripJsonc(text) {
  const st = { inStr: false, inSL: false, inML: false, esc: false, skip: false }
  let out = ""
  for (let i = 0; i < text.length; i++) {
    if (st.skip) { st.skip = false; continue }
    out += scanChar(st, text[i], text[i + 1])
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
// Faz o parse dos dois arquivos (best-effort). @returns { json, jsonc, parseError }.
function parseOpenCodePair(jsonPath, jsoncPath) {
  let json = {}, jsonc = {}, parseError = null
  try { json = JSON.parse(readFileSync(jsonPath, "utf-8")) } catch (e) { parseError = `opencode.json: ${e.message}` }
  try { jsonc = parseJsonc(readFileSync(jsoncPath, "utf-8")) } catch (e) { parseError = `${parseError ? parseError + "; " : ""}opencode.jsonc: ${e.message}` }
  return { json, jsonc, parseError }
}
export function planOpenCodeFix(home = homedir()) {
  const { jsonPath, jsoncPath } = ocPaths(home)
  const hasJson = existsSync(jsonPath), hasJsonc = existsSync(jsoncPath)
  if (!(hasJson && hasJsonc)) return { action: "none", jsonPath, jsoncPath, reason: "sem conflito json+jsonc" }

  const { json, jsonc, parseError } = parseOpenCodePair(jsonPath, jsoncPath)
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
 * Autoridade da config OpenCode (PRD24 §4.2): quem é a FONTE DE VERDADE.
 * Um `.jsonc` sensível (plugin/provider/model/OAuth) É a autoridade mesmo com um
 * `.json` ao lado (que fica sombreado) → "jsonc". "conflict" só quando ambos
 * coexistem e o `.jsonc` NÃO é sensível (autoridade ambígua / mergeável).
 * jsonc · json · directory_only (nenhum) · conflict.
 */
export function configAuthority(hasJson, hasJsonc, sensitiveCount = 0) {
  if (hasJsonc) return sensitiveCount > 0 || !hasJson ? "jsonc" : "conflict"
  return hasJson ? "json" : "directory_only"
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
    configAuthority: configAuthority(hasJson, hasJsonc, jsoncSensitive.length),
    jsoncSensitiveKeys: jsoncSensitive, // só nomes
    shadowingRisk: shadowingRisk(conflict, jsoncSensitive.length),
    disabledResidue: hasDisabled ? disabledPath : null,
    recommendedAction: hasDisabled ? "restore-jsonc" : planOpenCodeFix(home).action,
    parseError,
  }
}
