import { execFileSync as defaultExecFileSync } from "child_process"
import { mkdirSync } from "fs"
import { homedir, platform as osPlatform, tmpdir } from "os"
import { join, dirname } from "path"
import { findWorkingBinary } from "../installer/deps.js"
import { runPrintingPress } from "./cli.js"

const HOME = homedir()
const SAFE_SLUG = /^[a-zA-Z0-9._-]+$/
// Versao pinada para o tarball oficial no Linux (reprodutivel)
const GO_LINUX_VERSION = "go1.22.5"

/**
 * Instalacao opt-in de uma ferramenta do catalogo Printing Press.
 *
 * O `install` do printing-press-library roda `go install` por baixo (compila
 * CLI Go). Como o projeto ja instala bun/uv/Rust/Chromium automaticamente, o Go
 * tambem e instalado — mas SOB DEMANDA (so quando o usuario roda `tools install`),
 * nao no bootstrap, para nao forcar ~150MB em quem nao usa Printing Press.
 * Binarios das tools vao para ~/go/bin (GOPATH/bin) — verificados antes de "installed".
 */

export function isGoAvailable(exec) {
  return findWorkingBinary(["go"], exec ? { exec } : {}) !== ""
}

/** Candidatos do binario `go` por OS (toolchain pode viver fora do PATH atual). */
function goCandidates(home, plat) {
  if (plat === "win32") return ["go", "C:\\Program Files\\Go\\bin\\go.exe", join(home, "go", "bin", "go.exe")]
  if (plat === "darwin") return ["go", "/opt/homebrew/bin/go", "/usr/local/go/bin/go"]
  return ["go", join(home, ".local", "go", "bin", "go"), "/usr/local/go/bin/go"]
}

// Mapeia process.arch -> sufixo de arch do Go. null = arch nao suportada.
function goArch(arch) {
  return { x64: "amd64", arm64: "arm64", arm: "armv6l", ppc64: "ppc64le", s390x: "s390x" }[arch] || null
}

function installGoLinuxTarball(exec, home, arch = process.arch) {
  const goa = goArch(arch)
  if (!goa) {
    throw new Error(`arquitetura Linux nao suportada para auto-install do Go: ${arch}. Instale manual: https://go.dev/dl`)
  }
  // Sem sudo: tarball oficial -> ~/.local/go (go/ extrai dentro de ~/.local)
  const url = `https://go.dev/dl/${GO_LINUX_VERSION}.linux-${goa}.tar.gz`
  const tmp = join(tmpdir(), `${GO_LINUX_VERSION}-${goa}.tar.gz`)
  exec("curl", ["-fsSL", url, "-o", tmp], { stdio: "pipe", timeout: 300000 })
  const dest = join(home, ".local")
  mkdirSync(dest, { recursive: true })
  exec("tar", ["-C", dest, "-xzf", tmp], { stdio: "pipe", timeout: 120000 })
}

/**
 * Garante o toolchain Go — instala sob demanda se ausente.
 * @returns {{status:"present"|"installed"|"absent", bin?:string, error?:string}}
 */
export function ensureGo(opts = {}) {
  const exec = opts.exec || defaultExecFileSync
  const plat = opts.platform || osPlatform()
  const home = opts.home || HOME
  const cands = goCandidates(home, plat)

  let go = findWorkingBinary(cands, { exec })
  if (go) return { status: "present", bin: go }
  if (opts.autoInstall === false || process.env.GSTACK_SKIP_GO === "1") {
    return { status: "absent", error: "Go ausente (auto-install desabilitado)" }
  }

  try {
    if (plat === "win32") {
      try {
        exec("winget", ["install", "-e", "--id", "GoLang.Go", "--silent", "--accept-source-agreements", "--accept-package-agreements"], { stdio: "pipe", timeout: 300000 })
      } catch {
        exec("choco", ["install", "golang", "-y"], { stdio: "pipe", timeout: 300000 })
      }
    } else if (plat === "darwin") {
      exec("brew", ["install", "go"], { stdio: "pipe", timeout: 300000 })
    } else {
      installGoLinuxTarball(exec, home, opts.arch || process.arch)
    }
  } catch (e) {
    return { status: "absent", error: `falha ao instalar Go: ${e.message}. Instale manual: https://go.dev/dl` }
  }

  go = findWorkingBinary(cands, { exec })
  if (!go) return { status: "absent", error: "Go instalado mas nao encontrado. Reinicie o terminal." }
  // Garante o go no PATH da sessao p/ o `go install` subsequente
  const sep = plat === "win32" ? ";" : ":"
  process.env.PATH = dirname(go) + sep + (process.env.PATH || "")
  return { status: "installed", bin: go }
}

/** Nome provavel do binario instalado para um slug (heuristica: <slug>-pp-cli e <slug>). */
function candidateBinaries(slug) {
  return [
    `${slug}-pp-cli`,
    join(HOME, "go", "bin", `${slug}-pp-cli`),
    slug,
    join(HOME, "go", "bin", slug),
  ]
}

/**
 * Instala uma ferramenta. Retorna um objeto de status (nao lanca).
 * @param {string} slug
 * @param {object} [opts] { exec } injetavel
 */
export function installTool(slug, opts = {}) {
  if (!slug || !SAFE_SLUG.test(slug)) {
    return { name: slug, status: "invalid_slug", error: "slug invalido" }
  }
  // Go sob demanda: instala automaticamente se ausente (como bun/uv/Rust no projeto).
  const go = ensureGo(opts)
  if (go.status === "absent") {
    return { name: slug, status: "needs_go", error: go.error }
  }
  // install nao tem --json; sucesso e inferido probando o binario depois
  const res = runPrintingPress(["install", slug], { ...opts, timeout: opts.timeout || 300000 })
  if (!res.ok) {
    return { name: slug, status: "install_failed", error: res.error }
  }
  const bin = findWorkingBinary(candidateBinaries(slug), opts.exec ? { exec: opts.exec } : {})
  if (!bin) {
    return {
      name: slug,
      status: "install_unverified",
      error: "comando rodou mas o binario nao foi encontrado (verifique ~/go/bin no PATH)",
    }
  }
  return {
    name: slug,
    cli: bin,
    status: "installed",
    provenance: ".printing-press.json",
  }
}

/** Desinstala — delega ao catalogo e sinaliza para limpar o registry. */
export function uninstallTool(slug, opts = {}) {
  if (!slug || !SAFE_SLUG.test(slug)) {
    return { name: slug, status: "invalid_slug" }
  }
  const res = runPrintingPress(["uninstall", slug, "--yes"], opts)
  return { name: slug, status: res.ok ? "uninstalled" : "uninstall_failed", error: res.error }
}
