/**
 * PRD45 S45.6 (P1.9) — ARTIFACT LOCK: verificação criptográfica no lugar de garantia declarativa.
 *
 * O Supply Chain Doctor declarava `hashes: ok` com uma string de recomendação, sem verificar
 * pin/digest/hash nenhum — garantia inexistente: imagem `latest`, clone sem commit fixo ou
 * download sem digest mudam o produto instalado a montante sem o doctor notar. Aqui, cada
 * artefato da cadeia declara um PIN imutável e é classificado:
 *   • image  → `repo@sha256:<64hex>` (nunca `:latest` nem tag mutável);
 *   • git    → repo + commit FIXO (40 hex, nunca branch/tag);
 *   • url    → URL + sha256 publicado (sem hash = `unknown` honesto, download é opt-in);
 *   • npm    → name + version EXATA + integrity (sha512 do lockfile).
 * Estados: `verified` (pin válido) · `unknown` (opt-in sem hash, não bloqueia mas nunca `ok`) ·
 * `blocked` (mutável/malformado/ausente onde a imutabilidade é exigida). NUNCA `ok` sem prova.
 *
 * PURO/testável. O lock do PRODUTO (GSTACK_ARTIFACT_LOCK) reflete o que o create/install usam.
 */
import { CASDOOR_IMAGE } from "../cli/create.js"

export const ARTIFACT_LOCK_SCHEMA = "gstack.artifact-lock.v1"

const SHA256_DIGEST = /@sha256:[0-9a-f]{64}$/
const GIT_COMMIT = /^[0-9a-f]{40}$/
const SHA256_HEX = /^[0-9a-f]{64}$/
const NPM_INTEGRITY = /^sha(256|512)-[A-Za-z0-9+/]+={0,2}$/
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const verified = (id, detail) => ({ id, status: "verified", detail })
const blocked = (id, reason) => ({ id, status: "blocked", reason })
const unknown = (id, reason) => ({ id, status: "unknown", reason })

function classifyImage(a) {
  if (SHA256_DIGEST.test(String(a.ref || ""))) return verified(a.id, `imagem fixada por digest: ${a.ref}`)
  return blocked(a.id, `imagem sem digest imutável (${a.ref || "?"}) — 'latest'/tag são mutáveis`)
}
function classifyGit(a) {
  if (GIT_COMMIT.test(String(a.commit || ""))) return verified(a.id, `repo no commit ${a.commit}`)
  return blocked(a.id, `repo sem commit fixo (${a.commit || "ausente"}) — branch/tag não são imutáveis`)
}
function classifyUrl(a) {
  if (SHA256_HEX.test(String(a.sha256 || ""))) return verified(a.id, `URL com sha256 publicado`)
  return unknown(a.id, "download remoto opt-in sem sha256 publicado — verificar na origem antes de executar")
}
function classifyNpm(a) {
  if (EXACT_SEMVER.test(String(a.version || "")) && NPM_INTEGRITY.test(String(a.integrity || ""))) return verified(a.id, `${a.name}@${a.version} com integrity`)
  return blocked(a.id, `${a.name}: exige version exata + integrity (veio ${a.version || "?"})`)
}

const CLASSIFIERS = { image: classifyImage, git: classifyGit, url: classifyUrl, npm: classifyNpm }

/** Classifica UM artefato. @returns { id, status:"verified"|"unknown"|"blocked", detail?|reason? } */
export function classifyArtifact(a = {}) {
  const fn = CLASSIFIERS[a.kind]
  if (!fn) return blocked(a.id || "?", `tipo de artefato desconhecido: ${a.kind}`)
  return fn(a)
}

/**
 * Verifica um lock inteiro. Agregação fail-closed: qualquer `blocked` ⇒ `blocked`; senão qualquer
 * `unknown` ⇒ `unknown`; só `verified` em todos ⇒ `verified`. NUNCA `ok`.
 */
export function verifyArtifactLock(artifacts = []) {
  const results = artifacts.map(classifyArtifact)
  const status = results.some((r) => r.status === "blocked") ? "blocked"
    : results.some((r) => r.status === "unknown") ? "unknown" : "verified"
  return { schema: ARTIFACT_LOCK_SCHEMA, status, artifacts: results }
}

/**
 * Lock do PRODUTO — os artefatos que o create/install de fato materializam. Fonte única para o
 * doctor. Reusa o CASDOOR_IMAGE já fixado por digest em create.js (nunca duplica o valor).
 */
export const GSTACK_ARTIFACT_LOCK = Object.freeze([
  { id: "casdoor-image", kind: "image", ref: CASDOOR_IMAGE, purpose: "IAM local (Casdoor)" },
])
