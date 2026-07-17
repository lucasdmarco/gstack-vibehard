/**
 * PRD45 S45.2 (P1.2) — policy de execução e contenção do Runtime Manifest.
 *
 * Um repositório CLONADO declara `command[]`/`cwd` no `.gstack/runtime.json`. A validação
 * estrutural (manifest.js) garante só que `command` é array de strings — não impede
 * `["node","-e","fetch(evil)"]` nem `cwd:"../../.."`. `shell:false` no spawn tampouco: o
 * vetor é o próprio binário + args e o diretório de trabalho. Este módulo é a camada de
 * confiança ANTES do spawn:
 *   • classifyCommand  — deny (interpretador c/ código inline / lixo) | allow (runner de
 *     projeto conhecido rodando ARQUIVO) | ask (binário fora da allowlist, precisa de trust);
 *   • resolveContainedCwd — resolve o cwd por REALPATH (pega symlink/junction) e exige que
 *     fique dentro do workspace;
 *   • manifestTrustDigest — sha256 canônico do manifest; muda ⇒ re-trust;
 *   • evaluateManifestExec — o gate: fail-closed, agrega violações, `ask` só passa com o
 *     `trustedDigest` correspondente (override auditado do usuário).
 *
 * PURO / injetável (o consumidor real é o `dev` em runtime-supervisor.js).
 */
import { createHash } from "node:crypto"
import { resolve, relative, isAbsolute, join } from "node:path"
import { realpathSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"

// Runners de projeto legítimos: gerenciadores de pacote / task runners. Rodar QUALQUER coisa
// através deles ainda é o fluxo normal de `dev` (`npm run x`, `pnpm start`). O bloqueio mira
// o interpretador que executa CÓDIGO passado como argumento, não o runner.
// Runners que o PRÓPRIO create emite nos templates entram aqui (senão o gate quebraria o
// `dev` de projeto recém-criado — regressão): pnpm/npm/yarn + `concurrently` (dev multi-serviço).
const PROJECT_RUNNERS = new Set(["npm", "npx", "pnpm", "pnpx", "yarn", "bun", "bunx", "deno", "make", "concurrently", "turbo", "nx"])
// Interpretadores + a flag que executa código inline. `node server.js` é ok; `node -e ...` não.
const INLINE_CODE_FLAGS = Object.freeze({
  node: ["-e", "--eval", "-p", "--print"],
  deno: ["eval"],
  python: ["-c"], python3: ["-c"], py: ["-c"],
  ruby: ["-e"], perl: ["-e", "-E"],
  bash: ["-c"], sh: ["-c"], zsh: ["-c"], dash: ["-c"],
  powershell: ["-c", "-command", "-encodedcommand", "-e"],
  pwsh: ["-c", "-command", "-encodedcommand", "-e"],
  cmd: ["/c", "/k"],
})
// Binários que só rodam ARQUIVO (não têm modo inline perigoso) — allow direto.
const FILE_INTERPRETERS = new Set(["node", "deno", "python", "python3", "ruby"])

const basenameLower = (bin) => String(bin).replace(/\\/g, "/").split("/").pop().replace(/\.exe$/i, "").toLowerCase()
const looksLikePath = (bin) => isAbsolute(bin) || bin.includes("/") || bin.includes("\\")

// Um dos args casa uma flag de código inline do interpretador?
function hasInlineCodeFlag(name, args) {
  const flags = INLINE_CODE_FLAGS[name]
  if (!flags) return false
  return args.some((a) => flags.includes(String(a).toLowerCase()))
}

const deny = (reason) => ({ decision: "deny", reason })
const allow = (reason) => ({ decision: "allow", reason })
const ask = (reason) => ({ decision: "ask", reason })

const isStructurallyValid = (command) => Array.isArray(command) && command.length > 0 && command.every((c) => typeof c === "string")
// Classifica o binário JÁ validado (name = basename lower). @returns verdict.
function classifyBinary(bin, name, args) {
  if (hasInlineCodeFlag(name, args)) return deny(`${name}: flag de código inline (eval) é proibida em manifest`)
  if (PROJECT_RUNNERS.has(name)) return allow(`runner de projeto (${name})`)
  if (FILE_INTERPRETERS.has(name) && !looksLikePath(bin)) return allow(`${name} rodando arquivo`)
  if (looksLikePath(bin)) return ask("binário por caminho — requer trust")
  return ask(`executável fora da allowlist (${name}) — requer trust`)
}
/**
 * Classifica um `command[]`. @returns {{ decision:"deny"|"allow"|"ask", reason:string }}
 */
export function classifyCommand(command) {
  if (!isStructurallyValid(command)) return deny("command inválido (array de strings não-vazio)")
  const [bin, ...args] = command
  return classifyBinary(bin, basenameLower(bin), args)
}

/**
 * Resolve `relCwd` sob `baseDir` e exige contenção por REALPATH (symlink/junction que aponta
 * para fora é pego aqui, ao contrário de um resolve puramente lógico).
 * @returns {{ ok:boolean, path?:string, reason?:string }}
 */
export function resolveContainedCwd(baseDir, relCwd = ".") {
  const base = safeReal(baseDir)
  const target = safeReal(resolve(baseDir, relCwd || "."))
  const rel = relative(base, target)
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    return { ok: false, reason: `cwd fora do workspace (escape/symlink): ${relCwd}` }
  }
  return { ok: true, path: target }
}
// realpath tolerante: se o caminho ainda não existe, resolve o ancestral existente e reanexa
// o resto — o que importa é que a raiz real do target esteja contida.
function safeReal(p) {
  try { return realpathSync(p) } catch { /* não existe ainda */ }
  let cur = resolve(p)
  const parts = []
  while (!existsSync(cur)) {
    const parent = resolve(cur, "..")
    if (parent === cur) break
    parts.unshift(cur.slice(parent.length + 1))
    cur = parent
  }
  try { return join(realpathSync(cur), ...parts) } catch { return resolve(p) }
}

// Ordena chaves recursivamente → JSON canônico (digest estável à ordem de escrita do arquivo).
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = canonical(v[k]); return o }, {})
  }
  return v
}
/** sha256 canônico do manifest — a "impressão digital" que o trust aprova. */
export function manifestTrustDigest(manifest) {
  return createHash("sha256").update(JSON.stringify(canonical(manifest || {}))).digest("hex")
}

const serviceLabelAt = (svc, i) => `services[${i}]${svc && svc.name ? ` (${svc.name})` : ""}`
const ALLOW = "allow"
// Motivo de violação de UM serviço (sem o label), ou null se allow+contido.
function serviceViolationReason(svc = {}, baseDir) {
  const cls = classifyCommand(svc.command)
  if (cls.decision === "deny") return { reason: cls.reason }
  const cwd = resolveContainedCwd(baseDir, svc.cwd || ".")
  if (!cwd.ok) return { reason: cwd.reason }
  if (cls.decision === ALLOW) return null
  // `ask` (binário fora da allowlist) só é violação até o trust do digest destravar.
  return { reason: cls.reason, ask: true }
}
function serviceViolation(svc, i, baseDir) {
  const v = serviceViolationReason(svc, baseDir)
  return v ? { at: serviceLabelAt(svc, i), ...v } : null
}

/**
 * Gate de execução do manifest (fail-closed). Aprova só se cada serviço for `allow` e contido.
 * `ask` (binário fora da allowlist) só passa quando `opts.trustedDigest` bate com o digest do
 * manifest — o usuário aprovou EXATAMENTE este conteúdo (override auditado). `deny` e escape de
 * cwd nunca passam, nem com trust.
 * @returns {{ ok:boolean, digest:string, violations:Array<{at,reason}>, needsTrust:boolean }}
 */
const findViolations = (manifest, baseDir) =>
  ((manifest && manifest.services) || []).map((s, i) => serviceViolation(s, i, baseDir)).filter(Boolean)

export function evaluateManifestExec(manifest, baseDir, opts = {}) {
  const digest = manifestTrustDigest(manifest)
  const found = findViolations(manifest, baseDir)
  const hard = found.filter((v) => !v.ask)
  const hasAsk = found.length > hard.length
  const trusted = Boolean(digest) && opts.trustedDigest === digest
  // hard (deny/escape) nunca passa; ask passa só com trust do digest exato.
  const ok = hard.length === 0 && (!hasAsk || trusted)
  return { ok, digest, violations: trusted ? hard : found, needsTrust: hasAsk && !trusted }
}

// ── persistência de trust por projeto (.gstack/runtime-trust.json) ──────────────
export const TRUST_SCHEMA = "gstack.runtime-trust.v1"
const trustPath = (cwd) => join(cwd, ".gstack", "runtime-trust.json")

/** Digest aprovado para este projeto (ou null). Tolera arquivo ausente/corrompido. */
export function readTrustedDigest(cwd) {
  try {
    const t = JSON.parse(readFileSync(trustPath(cwd), "utf-8"))
    return t && typeof t.digest === "string" ? t.digest : null
  } catch { return null }
}
/** Registra o digest aprovado (override auditado do usuário: aprova ESTE conteúdo). */
export function writeTrustedDigest(cwd, digest, meta = {}) {
  mkdirSync(join(cwd, ".gstack"), { recursive: true })
  writeFileSync(trustPath(cwd), JSON.stringify({ schema: TRUST_SCHEMA, digest, approvedAt: new Date().toISOString(), ...meta }, null, 2) + "\n")
  return digest
}
/** Gate resolvido contra o trust PERSISTIDO do projeto (o consumidor real do `dev`). */
export function evaluateManifestExecForProject(manifest, cwd) {
  return evaluateManifestExec(manifest, cwd, { trustedDigest: readTrustedDigest(cwd) })
}
