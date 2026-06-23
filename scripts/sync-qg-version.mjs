#!/usr/bin/env node
// Sincroniza QG_VERSION (hooks/hooks/qg.py) com a versão do package.json.
// Roda no lifecycle `npm version` → o label do QG nunca fica stale (o drift de
// CONTEÚDO continua coberto pelo qg_hash do próprio qg.py). Replace ANCORADO de
// uma única linha — alvo único, sem o problema multi-spot que bagunçava o README.
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, join } from "node:path"

const QG_LINE = /^QG_VERSION = ".*"$/m

/**
 * @param {{ pkgPath?:string, qgPath?:string }} [opts]
 * @returns {{ version:string, changed:boolean, qgPath:string }}
 */
export function syncQgVersion(opts = {}) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const pkgPath = opts.pkgPath || join(root, "package.json")
  const qgPath = opts.qgPath || join(root, "hooks", "hooks", "qg.py")
  const version = JSON.parse(readFileSync(pkgPath, "utf-8")).version
  if (!version) throw new Error("sync-qg-version: package.json sem campo version")
  const src = readFileSync(qgPath, "utf-8")
  if (!QG_LINE.test(src)) throw new Error(`sync-qg-version: linha QG_VERSION não encontrada em ${qgPath}`)
  const next = src.replace(QG_LINE, `QG_VERSION = "${version}"`)
  const changed = next !== src
  if (changed) writeFileSync(qgPath, next)
  return { version, changed, qgPath }
}

// CLI (não executa quando importado em teste)
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href
if (isMain) {
  try {
    const r = syncQgVersion()
    process.stderr.write(`sync-qg-version: QG_VERSION = ${r.version}${r.changed ? " (atualizado)" : " (já sincronizado)"}\n`)
  } catch (e) {
    process.stderr.write(`sync-qg-version: ERRO — ${e.message}\n`)
    process.exit(1)
  }
}
