import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { execFileSync as defaultExec } from "child_process"

/**
 * release-source-parity (PRD41 S41.0 / PRD40 P0.2) — impede publicar um pacote
 * que não pode ser AUDITADO/REPRODUZIDO a partir da fonte pública.
 *
 * A v4.0.0 foi publicada com `gitHead` de um commit que depois sumiu do histórico
 * público (reescrita), e chegou a ficar 72 commits à frente do remoto. Este gate
 * fecha isso: só passa quando o commit a publicar existe no remoto, a tag da versão
 * local e remota apontam para o MESMO commit, a árvore não está à frente do remoto
 * e (opcional) `npm pack` é reproduzível.
 *
 * Fail-closed por design: quando HÁ remoto e a paridade não se sustenta → `failed`
 * (bloqueante). Sem remoto configurado → `not_applicable` (não há o que auditar
 * contra). `exec` e `npmPack` são injetáveis — testes não tocam git/npm/rede real.
 */

export const SOURCE_PARITY_ID = "release-source-parity"

const gitRunner = (exec, cwd) => (...args) => {
  try { return String(exec("git", args, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 20000 }) || "").trim() }
  catch { return null }
}

const result = (status, detail) => ({ id: SOURCE_PARITY_ID, status, detail })

// (i) o commit a publicar existe em ALGUM branch remoto?
function headOnRemote(git, head) {
  const remoteBranches = git("branch", "-r", "--contains", head)
  if (remoteBranches === null) return { ok: false, reason: "git não pôde verificar o HEAD no remoto" }
  if (remoteBranches.trim()) return { ok: true }
  return { ok: false, reason: `commit ${head.slice(0, 8)} não está em nenhum branch remoto — publique a fonte antes` }
}

// (ii) a árvore local não pode estar À FRENTE do remoto (nunca publicar ahead).
function aheadOfRemote(git) {
  const count = git("rev-list", "--count", "@{u}..HEAD")
  if (count === null) return { ok: true, reason: "sem upstream — verificação de ahead pulada" }
  const n = parseInt(count, 10) || 0
  if (n > 0) return { ok: false, reason: `${n} commit(s) à frente do remoto — nunca publicar de árvore ahead` }
  return { ok: true }
}

// O OBJETO que a ref de tag aponta diretamente (tag-object p/ anotada, commit p/
// leve). `ls-remote` pode listar também o commit desreferenciado (`^{}`); a linha
// SEM `^{}` é o objeto direto — o mesmo que `git rev-parse <tag>` devolve local.
function remoteTagObject(lsRemoteOut) {
  const lines = lsRemoteOut.split("\n").map((l) => l.trim()).filter(Boolean)
  const direct = lines.find((l) => !l.includes("^{}")) || lines[0]
  return direct.split(/\s+/)[0]
}

// (iii) a tag local e a remota são o MESMO objeto (garantia mais forte que "mesmo
// commit": mesmo tagger/data/mensagem/alvo). `git rev-parse <tag>` = objeto direto.
function tagParity(git, version) {
  const tagV = `v${version}`
  const local = git("rev-parse", tagV)
  if (!local) return { ok: false, reason: `tag ${tagV} não existe localmente (crie e publique antes)` }
  const remote = git("ls-remote", "--tags", "origin", tagV)
  if (!remote) return { ok: false, reason: `tag ${tagV} não existe no remoto` }
  const remoteSha = remoteTagObject(remote)
  if (remoteSha === local) return { ok: true }
  return { ok: false, reason: `tag ${tagV}: local ${local.slice(0, 8)} ≠ remoto ${remoteSha.slice(0, 8)}` }
}

// npm pack com cache ISOLADO → shasum lógico do tarball (ou null em falha).
function defaultNpmPack(cwd, exec) {
  const run = exec || defaultExec
  return () => {
    try {
      const cache = mkdtempSync(join(tmpdir(), "gstack-npmcache-"))
      const out = String(run("npm", ["pack", "--dry-run", "--json", "--cache", cache], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 60000 }) || "")
      const arr = JSON.parse(out)
      return (arr && arr[0] && arr[0].shasum) || null
    } catch { return null }
  }
}

// (iv, opcional) `npm pack --dry-run` é reproduzível entre duas execuções?
function packReproducible(cwd, exec, npmPack) {
  const run = npmPack || defaultNpmPack(cwd, exec)
  const a = run()
  const b = run()
  if (a === null || b === null) return { ok: false, reason: "npm pack --dry-run falhou — tarball não reproduzível" }
  if (a === b) return { ok: true }
  return { ok: false, reason: `npm pack shasum instável entre execuções: ${a} ≠ ${b}` }
}

// Pré-condições: sem versão → failed; sem repo/remoto → not_applicable. null = ok
// para prosseguir com os sub-checks de paridade.
function parityPreconditions(git, version) {
  if (!version) return result("failed", "sem versão para verificar paridade")
  const remotes = git("remote")
  if (remotes === null) return result("not_applicable", "não é repositório git")
  if (!remotes.trim()) return result("not_applicable", "sem remoto configurado — nada a auditar contra")
  return null
}

// Roda os sub-checks de paridade e agrega o veredito (fail-closed em qualquer um).
function aggregateParity(git, head, opts, cwd, exec) {
  const subs = [headOnRemote(git, head), aheadOfRemote(git), tagParity(git, opts.version)]
  if (opts.checkPack === true) subs.push(packReproducible(cwd, exec, opts.npmPack))
  const failures = subs.filter((s) => !s.ok).map((s) => s.reason)
  if (failures.length) return result("failed", failures.join(" | "))
  return result("passed", `commit ${head.slice(0, 8)} no remoto, tag v${opts.version} corresponde`)
}

/**
 * Verifica a paridade fonte↔release. `version` vem do package. Sem remoto `origin`
 * → not_applicable. Com remoto: falha fechado se qualquer sub-check reprovar.
 * `checkPack:true` inclui a reprodutibilidade do `npm pack` (mais pesado).
 */
export function checkSourceParity(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const exec = opts.exec || defaultExec
  const git = gitRunner(exec, cwd)
  const pre = parityPreconditions(git, opts.version)
  if (pre) return pre
  const head = git("rev-parse", "HEAD")
  if (!head) return result("failed", "não foi possível resolver o HEAD")
  return aggregateParity(git, head, opts, cwd, exec)
}
