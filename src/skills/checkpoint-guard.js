import { resolve, relative, isAbsolute, dirname } from "path"
import { realpathSync, existsSync } from "fs"
import { hasSecret } from "../security/redact.js"

/**
 * Guardas de segurança dos checkpoints (PRD41 S41.7 / PRD40 P0.7).
 *
 * Um checkpoint captura arquivos do working tree e os restaura depois — se aceitar path
 * traversal, symlink/junction que escapa o root, `.env`/segredo, ou restaurar um blob
 * ADULTERADO, vira um vetor de exfiltração/corrupção. Estas guardas são PURAS/injetáveis
 * e falham FECHADO: rejeitam ANTES de ler o arquivo (containment/denylist) e ABORTAM o
 * rollback se qualquer blob não bater com o hash do manifesto (tamper).
 */

// IDs (runId/seq) são do SISTEMA — input externo com traversal/estranho é rejeitado.
export const CHECKPOINT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
export function validCheckpointId(id) {
  return typeof id === "string" && id !== "." && id !== ".." && CHECKPOINT_ID_RE.test(id)
}

// Denylist obrigatória por PATH: `.env*`, `.git/`, e configs globais óbvias nunca entram.
const DENY_PATH_RE = /(^|[/\\])(\.env(\.[^/\\]*)?|\.git|\.ssh|\.aws|\.npmrc|id_rsa[^/\\]*)([/\\]|$)/i
export function isDeniedPath(rel) {
  return DENY_PATH_RE.test(String(rel || ""))
}

function canonical(p) {
  try { return realpathSync(p) } catch { return resolve(p) }
}

// Canonicaliza o ancestral EXISTENTE mais próximo (pega symlink/junction mesmo que o
// alvo final ainda não exista) e resolve o resto lexicalmente.
function canonicalExistingPrefix(abs) {
  let dir = abs
  while (dir && dir !== dirname(dir) && !existsSync(dir)) dir = dirname(dir)
  const canonDir = canonical(dir)
  const tail = relative(dir, abs)
  return tail ? resolve(canonDir, tail) : canonDir
}

function within(rootCanon, target) {
  const rel = relative(rootCanon, target)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/**
 * Resolve `rel` DENTRO de `root` (canônico) ou rejeita. Pega: absoluto, `../` lexical,
 * E symlink/junction/UNC que canonicalize para fora do root. Rejeição = fail-closed,
 * ANTES de qualquer leitura.
 */
export function resolveWithin(root, rel) {
  if (typeof rel !== "string" || !rel) return { ok: false, reason: `caminho vazio` }
  if (isAbsolute(rel)) return { ok: false, reason: `caminho absoluto rejeitado: ${rel}` }
  const rootCanon = canonical(root)
  const target = resolve(rootCanon, rel)
  if (!within(rootCanon, target)) return { ok: false, reason: `path traversal — fora do root: ${rel}` }
  const canonTarget = canonicalExistingPrefix(target)
  if (!within(rootCanon, canonTarget)) return { ok: false, reason: `symlink/junction escapa o root: ${rel}` }
  return { ok: true, abs: target }
}

/**
 * Um arquivo pode entrar num checkpoint? Rejeita por PATH (denylist/containment) ANTES
 * de ler; se o conteúdo (já lido) contém segredo, também nega. Retorna motivo tipado.
 */
export function screenCheckpointPath(root, rel) {
  if (isDeniedPath(rel)) return { ok: false, reason: `denylist: ${rel} (segredo/credencial/.git nunca entra em checkpoint)` }
  return resolveWithin(root, rel)
}

/** Conteúdo já lido contém segredo? (rede final: arquivo permitido mas com segredo embutido) */
export function contentHasSecret(buf) {
  if (buf == null) return false
  try { return hasSecret(buf.toString("utf-8")) } catch { return false }
}
