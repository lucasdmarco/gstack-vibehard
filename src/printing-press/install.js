import { homedir } from "os"
import { join } from "path"
import { findWorkingBinary } from "../installer/deps.js"
import { runPrintingPress } from "./cli.js"

const HOME = homedir()
const SAFE_SLUG = /^[a-zA-Z0-9._-]+$/

/**
 * Instalacao opt-in de uma ferramenta do catalogo Printing Press.
 *
 * Importante: o `install` do printing-press-library roda `go install` por baixo
 * (compila CLI Go). Por isso:
 *  - exige toolchain Go (detectamos; sem Go nao instala, orienta)
 *  - binarios vao para ~/go/bin (GOPATH/bin) — verificamos la antes de marcar "installed"
 */

export function isGoAvailable(exec) {
  return findWorkingBinary(["go"], exec ? { exec } : {}) !== ""
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
  if (!isGoAvailable(opts.exec)) {
    return {
      name: slug,
      status: "needs_go",
      error: "Toolchain Go ausente — `install` compila CLI Go. Instale Go (https://go.dev/dl) e tente de novo.",
    }
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
