import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"
import { homedir } from "os"
import { stripBom } from "../util/json.js"
import { detectProvider, vaultBase } from "./providers.js"

/**
 * Secrets Broker (PRD 12 §10): orquestra o provider do SO. O VALOR nunca toca o
 * repo nem o state — vive no keychain e é resolvido SÓ em memória, na hora de subir
 * o serviço. O gstack guarda um índice de NOMES/metadados (`names.json`), nunca
 * valores. PURO/testável (provider injetável). Namespace por projeto (hash do path).
 */

/** Namespace estável e curto por projeto (não vaza o path real). */
export function projectNamespace(projectDir) {
  return createHash("sha256").update(String(projectDir || "")).digest("hex").slice(0, 16)
}

function indexBase(opts) { return opts && opts.vaultDir ? opts.vaultDir : vaultBase() }
function indexPath(ns, opts) { return join(indexBase(opts), ns, "names.json") }

function readIndex(ns, opts) {
  const p = indexPath(ns, opts)
  if (!existsSync(p)) return { names: {} }
  try { const j = JSON.parse(stripBom(readFileSync(p, "utf-8"))); return j && j.names ? j : { names: {} } }
  catch { return { names: {} } }
}
function writeIndex(ns, idx, opts) {
  const dir = join(indexBase(opts), ns)
  mkdirSync(dir, { recursive: true })
  writeFileSync(indexPath(ns, opts), JSON.stringify(idx, null, 2) + "\n")
}

/** Provider ativo + disponibilidade. `provider` injetável (teste). */
export function brokerStatus(opts = {}) {
  const provider = opts.provider || detectProvider(opts)
  return { provider: provider ? provider.id : null, available: !!provider }
}

/** Guarda um segredo no keychain + registra o NOME no índice (sem valor). */
export function setSecret(projectDir, name, value, opts = {}) {
  const provider = opts.provider || detectProvider(opts)
  if (!provider) throw new Error("nenhum keychain disponível (broker indisponível)")
  if (!name || typeof value !== "string") throw new Error("nome/valor inválido")
  const ns = projectNamespace(projectDir)
  provider.set(ns, name, value)
  const idx = readIndex(ns, opts)
  idx.names[name] = { setAt: new Date().toISOString(), sensitive: opts.sensitive !== false }
  writeIndex(ns, idx, opts)
  return { name, provider: provider.id }
}

/** Lê um segredo (EM MEMÓRIA). Nunca persiste/loga. null se ausente. */
export function getSecret(projectDir, name, opts = {}) {
  const provider = opts.provider || detectProvider(opts)
  if (!provider) return null
  return provider.get(projectNamespace(projectDir), name)
}

/** Remove do keychain + do índice. Idempotente. */
export function deleteSecret(projectDir, name, opts = {}) {
  const provider = opts.provider || detectProvider(opts)
  const ns = projectNamespace(projectDir)
  if (provider) provider.delete(ns, name)
  const idx = readIndex(ns, opts)
  delete idx.names[name]
  writeIndex(ns, idx, opts)
  return { name }
}

/** Nomes guardados (do índice) + metadados — NUNCA valores. */
export function listSecretNames(projectDir, opts = {}) {
  const idx = readIndex(projectNamespace(projectDir), opts)
  return Object.entries(idx.names).map(([name, meta]) => ({ name, ...meta }))
}

/** Resolve um conjunto de nomes para `{NAME: value}` EM MEMÓRIA (só os existentes). */
export function resolveSecrets(projectDir, names, opts = {}) {
  const provider = opts.provider || detectProvider(opts)
  const out = {}
  if (!provider) return out
  const ns = projectNamespace(projectDir)
  for (const name of names || []) {
    const v = provider.get(ns, name)
    if (v != null) out[name] = v
  }
  return out
}

/** Redação: troca valores de segredo por `***` (defesa adicional p/ logs/erros). */
export function redact(text, values) {
  let s = String(text == null ? "" : text)
  for (const v of values || []) {
    if (v && String(v).length >= 4) s = s.split(String(v)).join("***")
  }
  return s
}

/** Parse de `.env` (KEY=VALUE) — para `secrets import`. Ignora comentários/linhas vazias. */
export function parseDotEnv(text) {
  const out = {}
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    let key = line.slice(0, eq).trim()
    if (key.startsWith("export ")) key = key.slice(7).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    out[key] = val
  }
  return out
}

export { vaultBase }
