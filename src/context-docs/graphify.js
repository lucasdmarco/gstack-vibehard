import { existsSync } from "fs"
import { join } from "path"

/**
 * Graphify bridge: localiza o grafo de CÓDIGO (graphify-out/graph.json) gerado
 * pelo Graphify. Se existir, o indexer Python o lê para criar edges
 * `implemented_in`/`depends_on` ligando entidades de doc ao código.
 * Ausência → nenhum edge de código (degrada, não quebra).
 */
export function findGraphifyOutput(cwd) {
  const p = join(cwd, "graphify-out", "graph.json")
  return existsSync(p) ? p : null
}
