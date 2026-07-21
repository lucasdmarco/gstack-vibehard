/**
 * PRD46 S46.1 (§7.4) — descoberta READ-ONLY de artefatos externos (Agent Skills /
 * manifests de plugin `.claude-plugin/plugin.json|marketplace.json`). NUNCA copia,
 * executa ou confia no conteúdo — só produz metadados validados para o Source Lock
 * decidir (governança de auditoria/aprovação fica em `source-lock.js`).
 *
 * Bloqueia (fail-closed): profundidade além do limite, symlink que escapa do root,
 * nome malformado/travessia declarado no manifest, e shadowing ambíguo (dois
 * artefatos reivindicando o mesmo nome — roteamento ambíguo é pior que nenhum).
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs"
import { join, relative, isAbsolute } from "node:path"

export const DISCOVERY_SCHEMA = "gstack.skill-discovery.v1"

const MAX_DEPTH = 6
const NAME_RX = /^[a-z0-9][a-z0-9-]{0,63}$/
const MANIFEST_NAMES = new Set(["SKILL.md", "plugin.json", "marketplace.json"])

function defaultIo() {
  return {
    listDir: (dir) => {
      try { return readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })) }
      catch { return [] }
    },
    read: (p) => { try { return readFileSync(p, "utf-8") } catch { return null } },
    realpath: (p) => { try { return realpathSync(p) } catch { return null } },
  }
}

function parseSkillName(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "")
  if (!m) return null
  const nameLine = m[1].split(/\r?\n/).find((l) => /^name:/.test(l.trim()))
  if (!nameLine) return null
  return nameLine.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "")
}

function parsePluginName(text) {
  try { return JSON.parse(text || "null")?.name ?? null } catch { return null }
}

function artifactKindFor(manifestName) {
  if (manifestName === "SKILL.md") return "skill"
  if (manifestName === "marketplace.json") return "reference_pack"
  return "rule_pack" // plugin.json
}

/**
 * @param {{root: string, io?: object}} opts io é injetável (testes nunca tocam o fs real).
 * @returns {{schemaVersion:string, found:object[], problems:object[], ok:boolean}}
 */
export function discoverArtifacts({ root, io } = {}) {
  const fsio = io || defaultIo()
  const rootReal = fsio.realpath(root) || root
  const found = []
  const problems = []
  const seenNames = new Map()

  const flag = (p, reason) => problems.push({ path: p, reason })

  function isContained(entryPath) {
    const real = fsio.realpath(entryPath)
    if (!real) return true // não existe ainda / io não resolveu — outros checks decidem
    const rel = relative(rootReal, real)
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
  }

  function registerManifest(dir, manifestPath, manifestName) {
    const text = fsio.read(manifestPath)
    const declaredName = manifestName === "SKILL.md" ? parseSkillName(text) : parsePluginName(text)
    const name = declaredName || ""
    if (!NAME_RX.test(name)) { flag(manifestPath, `nome malformado ou ausente: ${JSON.stringify(declaredName)}`); return }
    if (seenNames.has(name)) { flag(manifestPath, `shadowing ambíguo: '${name}' já descoberto em ${seenNames.get(name)}`); return }
    seenNames.set(name, manifestPath)
    found.push({ name, artifactKind: artifactKindFor(manifestName), manifestPath, dir })
  }

  function processEntry(dir, e, depth) {
    const p = join(dir, e.name)
    if (e.isDirectory) { walk(p, depth + 1); return }
    if (!MANIFEST_NAMES.has(e.name)) return
    if (!isContained(p)) { flag(p, "symlink escape do root"); return }
    registerManifest(dir, p, e.name)
  }

  function walk(dir, depth) {
    if (depth > MAX_DEPTH) { flag(dir, `profundidade além do limite (${MAX_DEPTH})`); return }
    if (!isContained(dir)) { flag(dir, "symlink escape do root"); return }
    for (const e of fsio.listDir(dir)) processEntry(dir, e, depth)
  }

  walk(root, 0)
  return { schemaVersion: DISCOVERY_SCHEMA, found, problems, ok: problems.length === 0 }
}
