import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

/**
 * Inspeção segura da config do OpenCode (PRD opencode-config-conflict).
 *
 * Verificado na doc oficial (opencode.ai/docs/config, /plugins, /skills):
 *  - OpenCode suporta JSON e JSONC; config global canônica é
 *    `~/.config/opencode/opencode.json`.
 *  - A coexistência de `opencode.json` + `opencode.jsonc` no MESMO diretório
 *    NÃO é documentada → tratamos como inseguro (não criar concorrente).
 *  - Plugins auto-carregam de `~/.config/opencode/plugins/` SEM entrada no config.
 *  - Skills auto-carregam de `~/.config/opencode/skills/*` e de `~/.agents/skills/*`
 *    SEM config. Logo o gstack integra por diretórios, sem precisar escrever config.
 *
 * Por isso o gstack só escreve `opencode.json` quando ele JÁ existe sozinho
 * (merge não-destrutivo). Em qualquer cenário com `.jsonc`, não toca em config.
 */

export const OPENCODE_STRATEGIES = Object.freeze({
  JSON_MERGE: "json_merge", // só .json: merge não-destrutivo (preserva chaves do usuário)
  DIRECTORY_ONLY: "directory_only", // sem .json seguro p/ escrever: integra só por plugins/skills
  CONFLICT_WARN_ONLY: "conflict_warn_only", // .json E .jsonc coexistem: não escreve nada, alerta
})

export function inspectOpenCodeConfig(home = homedir()) {
  const configDir = join(home, ".config", "opencode")
  const jsonPath = join(configDir, "opencode.json")
  const jsoncPath = join(configDir, "opencode.jsonc")
  const hasJson = existsSync(jsonPath)
  const hasJsonc = existsSync(jsoncPath)
  const hasConflict = hasJson && hasJsonc

  let preferredStrategy
  const warnings = []
  if (hasConflict) {
    preferredStrategy = OPENCODE_STRATEGIES.CONFLICT_WARN_ONLY
    warnings.push(
      "OpenCode: detectados opencode.json e opencode.jsonc no mesmo diretório. " +
      "Isso pode causar conflito de configuração (especialmente com plugins OAuth). " +
      "O gstack NÃO alterou esses arquivos. Se o Desktop usa opencode.jsonc, renomeie " +
      "opencode.json para opencode.json.gstack-bak com o OpenCode fechado."
    )
  } else if (hasJsonc) {
    // Só .jsonc → nunca criar .json concorrente; integrar por diretórios auto-load.
    preferredStrategy = OPENCODE_STRATEGIES.DIRECTORY_ONLY
    warnings.push("OpenCode: config é opencode.jsonc — preservada. Integração via plugins/skills (auto-load).")
  } else if (hasJson) {
    preferredStrategy = OPENCODE_STRATEGIES.JSON_MERGE
  } else {
    // Nenhum config: a doc confirma que plugins/skills auto-carregam sem config,
    // então NÃO criamos opencode.json (evita config concorrente desnecessário).
    preferredStrategy = OPENCODE_STRATEGIES.DIRECTORY_ONLY
  }

  return { configDir, jsonPath, jsoncPath, hasJson, hasJsonc, hasConflict, preferredStrategy, warnings }
}

/** True só quando é seguro fazer merge/escrita no opencode.json. */
export function shouldWriteOpenCodeJson(report) {
  return report.preferredStrategy === OPENCODE_STRATEGIES.JSON_MERGE
}
