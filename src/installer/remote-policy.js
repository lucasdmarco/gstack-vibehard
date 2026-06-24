/**
 * Política de download/execução remota (PRD finalprd10 P0.6).
 *
 * Por PADRÃO o gstack NÃO baixa nem executa scripts remotos — sugere o comando
 * manual. Só executa quando o usuário habilita EXPLICITAMENTE (`--allow-remote-
 * downloads` ou `GSTACK_ALLOW_REMOTE_DOWNLOADS=1`) E a origem está na allowlist
 * HTTPS. Isso fecha o vetor `curl|sh` / `irm|iex` / `ExecutionPolicy Bypass`.
 */

// Allowlist de ORIGENS HTTPS confiáveis (instaladores oficiais conhecidos).
export const ALLOWED_REMOTE_ORIGINS = Object.freeze([
  // (atomic-vcs.dev removido: domínio morto. Atomic VCS agora vem de
  //  github.com/atomicdotdev/atomic via git clone + cargo, sem download de script.)
  "https://sh.rustup.rs",
  "https://bun.sh",
  "https://astral.sh",      // uv
  "https://install.python-poetry.org",
])

/** True se downloads remotos estão habilitados (opt-in explícito). */
export function remoteDownloadsEnabled(opts = {}) {
  if (opts.allowRemote === true) return true
  if (opts.allowRemote === false) return false
  return process.env.GSTACK_ALLOW_REMOTE_DOWNLOADS === "1"
}

/** Valida origem: precisa ser HTTPS e estar na allowlist. */
export function isRemoteAllowed(url) {
  try {
    const u = new URL(String(url))
    if (u.protocol !== "https:") return false
    return ALLOWED_REMOTE_ORIGINS.some((o) => `${u.protocol}//${u.host}` === o)
  } catch {
    return false
  }
}

/**
 * Decide se um download remoto pode prosseguir. Retorna `{ allowed, reason }`.
 * `allowed=false` NUNCA executa — o caller deve sugerir o comando manual.
 */
export function checkRemoteDownload(url, opts = {}) {
  if (!remoteDownloadsEnabled(opts)) {
    return { allowed: false, reason: "downloads remotos desabilitados (use --allow-remote-downloads para permitir)" }
  }
  if (!isRemoteAllowed(url)) {
    return { allowed: false, reason: `origem fora da allowlist HTTPS: ${url}` }
  }
  return { allowed: true, reason: "permitido (opt-in + origem confiável)" }
}
