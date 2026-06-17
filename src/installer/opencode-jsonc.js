import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { mergeJson } from "./merge.js"
import { versionedBackup } from "./safe-write.js"

/**
 * Correção assistida do drift OpenCode (PRD Fase 3 §7): quando `opencode.json` e
 * `opencode.jsonc` coexistem, parseia o JSONC (tolerante a comentários/trailing
 * commas), faz um merge SEGURO preservando OAuth/plugin/provider do usuário e
 * consolida em um único `opencode.json`, com backup dos dois.
 */

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

function ocPaths(home) {
  const dir = join(home, ".config", "opencode")
  return { jsonPath: join(dir, "opencode.json"), jsoncPath: join(dir, "opencode.jsonc") }
}

/**
 * Plano de correção (read-only). action: "none" | "manual" | "merge".
 * merge preserva as chaves do USUÁRIO (jsonc) em conflito.
 */
export function planOpenCodeFix(home = homedir()) {
  const { jsonPath, jsoncPath } = ocPaths(home)
  const hasJson = existsSync(jsonPath), hasJsonc = existsSync(jsoncPath)
  if (!(hasJson && hasJsonc)) return { action: "none", jsonPath, jsoncPath, reason: "sem conflito json+jsonc" }

  let json = {}, jsonc = {}, parseError = null
  try { json = JSON.parse(readFileSync(jsonPath, "utf-8")) } catch (e) { parseError = `opencode.json: ${e.message}` }
  try { jsonc = parseJsonc(readFileSync(jsoncPath, "utf-8")) } catch (e) { parseError = `${parseError ? parseError + "; " : ""}opencode.jsonc: ${e.message}` }
  if (parseError) return { action: "manual", jsonPath, jsoncPath, parseError }

  // mergeJson(a, b) → b vence em conflito. Queremos o USUÁRIO (jsonc) com prioridade.
  const merged = mergeJson(json, jsonc)
  const userKeys = Object.keys(jsonc)
  return { action: "merge", jsonPath, jsoncPath, merged, userKeysPreserved: userKeys }
}

/** Aplica o merge: backup dos dois, escreve o merge no .json, remove o .jsonc (preservado no backup). */
export function applyOpenCodeFix(home = homedir()) {
  const plan = planOpenCodeFix(home)
  if (plan.action !== "merge") return { applied: false, ...plan }
  versionedBackup(plan.jsonPath)
  versionedBackup(plan.jsoncPath)
  writeFileSync(plan.jsonPath, JSON.stringify(plan.merged, null, 2) + "\n")
  unlinkSync(plan.jsoncPath) // conflito resolvido; original preservado no .gstack_vibehard.bak
  return { applied: true, jsonPath: plan.jsonPath, jsoncPath: plan.jsoncPath }
}
