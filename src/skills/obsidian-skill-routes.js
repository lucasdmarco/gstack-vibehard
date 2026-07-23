import { relative, isAbsolute } from "node:path"
import { buildSourceLock } from "./source-lock.js"

/**
 * Governed Obsidian skill bundle (PRD49 S49.6).
 *
 * Roteia por intent — só a skill que casa entra no context pack (nunca mais
 * de uma). Vendorizado via o pipeline REAL do PRD46 (`source-lock.js`
 * `buildSourceLock`/`validateSourceLock`), não um manifest inventado. 4 das 5
 * skills upstream foram vendorizadas nesta sprint (ver
 * `skills/vendor/kepano-obsidian-skills/<commit>/upstream-map.md`); `defuddle`
 * fica `not_yet_vendored` por um achado real do auditor externo (instrução de
 * `npm install -g` no upstream — instalação global nunca é copiada verbatim).
 *
 * Invariante permanente do projeto: nunca auto-abre o Obsidian, nunca cria
 * cofre, nunca varre vault global implícito — detectar ≠ indexar.
 */
export const OBSIDIAN_SKILL_ROUTES_SCHEMA = "gstack.obsidian-skill-routes.v1"

const VENDOR_ROOT_REL = "skills/vendor/kepano-obsidian-skills/a1dc48e68138490d522c04cbf5822214c6eb1202"
const REPOSITORY = "https://github.com/kepano/obsidian-skills"
const COMMIT = "a1dc48e68138490d522c04cbf5822214c6eb1202"
const LICENSE = "MIT"

export const OBSIDIAN_INTENTS = Object.freeze([
  { intent: "write_link_note", skill: "obsidian-markdown", gate: "vault-boundary + syntax", status: "vendored", entry: "skills/obsidian-markdown/SKILL.md" },
  { intent: "create_base", skill: "obsidian-bases", gate: "yaml-schema + obsidian-render-advisory", status: "vendored", entry: "skills/obsidian-bases/SKILL.md" },
  { intent: "create_canvas", skill: "json-canvas", gate: "json-schema + node-edge-integrity", status: "vendored", entry: "skills/json-canvas/SKILL.md" },
  { intent: "operate_running_app", skill: "obsidian-cli", gate: "app-cli-doctor + approval-for-mutation", status: "vendored", entry: "skills/obsidian-cli/SKILL.md" },
  {
    intent: "ingest_webpage", skill: "defuddle", gate: "network-consent + provenance + prompt-injection-scan",
    status: "not_yet_vendored", entry: null,
    reason: "upstream SKILL.md instrui 'npm install -g defuddle' (instalação global) — nunca copiado verbatim sem decisão explícita do usuário.",
  },
])

/** Roteia UM intent -> a linha da tabela (ou null). Nunca mais de 1 skill por intent. */
export function routeObsidianIntent(intent) {
  return OBSIDIAN_INTENTS.find((r) => r.intent === intent) || null
}

/** `targetPath` fica DENTRO de `vaultRoot`? Mesma idiom de path-containment de checkpoint-guard.js. */
export function resolveWithinVault(vaultRoot, targetPath) {
  const rel = relative(vaultRoot, targetPath)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

const ENV_PATH_RX = /(^|[\\/])\.env($|[.\\/])/i

/** `.env`/`.env.local`/aninhado em qualquer profundidade -> nunca escrito/ingerido na vault. */
export function isSecretOrEnvPath(relPath) {
  return ENV_PATH_RX.test(String(relPath || ""))
}

/** Escrita real numa vault: nunca escapa a raiz, nunca grava em caminho de secret/.env. */
export function canWriteToVault({ vaultRoot, targetPath, relPath }) {
  if (isSecretOrEnvPath(relPath)) return { ok: false, reason: "secret_or_env_path_excluded" }
  if (!resolveWithinVault(vaultRoot, targetPath)) return { ok: false, reason: "path_escapes_vault_root" }
  return { ok: true }
}

/** Source lock REAL (pipeline PRD46) para um arquivo vendorizado. PURO — recebe conteúdo já lido. */
export function buildObsidianSourceLock({ relEntryPath, content, intents = [] }) {
  return buildSourceLock({
    repository: REPOSITORY, commit: COMMIT, path: `${VENDOR_ROOT_REL}/${relEntryPath}`,
    license: LICENSE, artifactKind: "skill", originalContent: content, routing: { intents },
  })
}
