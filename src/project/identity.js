import { existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from "fs"
import { join, resolve } from "path"
import { randomUUID } from "crypto"

/**
 * Identidade de projeto (PRD41 S41.2 / PRD40 P0.3) — o ESPELHO JS do marcador
 * canônico que os hooks Python (`hooks/hooks/_paths.py`) validam. A mera existência
 * de `.gstack/` NÃO ativa mais um projeto: só um `.gstack/project.json` VÁLIDO cujo
 * `root` canônico corresponde ao diretório. Portanto tudo que "ativa" um projeto no
 * lado JS (`create`, `enable`) TEM que gravar este marcador — senão o projeto nasce
 * inerte (hooks passivos) e viraria falso-verde ("ativado" sem ativação real).
 *
 * O formato precisa casar byte-a-byte de contrato com `_valid_project_marker`:
 * `schemaVersion === PROJECT_MARKER_SCHEMA` e `resolve(root) === resolve(dir)`.
 */
export const PROJECT_MARKER_SCHEMA = "gstack.project.v1"

const markerPath = (root) => join(root, ".gstack", "project.json")

/** Caminho canônico (segue symlinks quando o dir existe) — casa com `Path.resolve()`
 * do Python, que é o que o hook usa para comparar o `root` declarado. */
function canonical(p) {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

/**
 * Grava/atualiza `.gstack/project.json` marcando o projeto como ATIVADO. `mode` é o
 * tier de instalação (`lite`|`full`), separado do `profile.mode` (observe/enforce).
 * Retorna o marcador. Idempotente: preserva `projectId` de um marcador existente.
 */
export function writeProjectMarker(root, { mode = "lite", createdBy = "gstack_vibehard", projectId } = {}) {
  const canonRoot = canonical(root)
  const gdir = join(canonRoot, ".gstack")
  mkdirSync(gdir, { recursive: true })
  const existing = readProjectMarker(canonRoot)
  const marker = {
    schemaVersion: PROJECT_MARKER_SCHEMA,
    projectId: projectId || existing?.projectId || randomUUID(),
    root: canonRoot,
    mode,
    activated: true,
    createdBy,
  }
  writeFileSync(markerPath(canonRoot), JSON.stringify(marker, null, 2) + "\n", "utf8")
  return marker
}

/** Lê o marcador se presente e parseável; senão `null`. Não valida o `root`. */
export function readProjectMarker(root) {
  const p = markerPath(root)
  if (!existsSync(p)) return null
  try {
    const data = JSON.parse(readFileSync(p, "utf8"))
    return data && typeof data === "object" && !Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

/**
 * True se `root` tem um marcador VÁLIDO (schema correto + `root` canônico batendo com
 * o diretório). Espelha `_valid_project_marker` do Python — é a fonte de verdade da
 * ativação, então `status` deve reportar ATIVO por AQUI (não só por `.gstack/` existir).
 */
export function hasValidMarker(root) {
  const data = readProjectMarker(root)
  if (!data || data.schemaVersion !== PROJECT_MARKER_SCHEMA) return false
  if (!data.root) return false
  return canonical(data.root) === canonical(root)
}
