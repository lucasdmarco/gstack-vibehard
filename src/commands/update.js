import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { section, success, warn, info } from "../cli/index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG = "@gstack-vibehard/installer"
// Dois passos SEPARADOS — `&&` não existe no PowerShell do Windows (produto é
// Windows-first; encadear com && quebra na máquina limpa). O usuário roda os dois.
const UPDATE_STEP_INSTALL = `npm install -g ${PKG}@latest`
const UPDATE_STEP_REFRESH = "gstack_vibehard install"
const UPDATE_CMD = UPDATE_STEP_INSTALL // compat de JSON (campo `command`)

/** npm cross-platform (npm.cmd dá EINVAL no execFileSync direto no Windows). */
function defaultNpmExec(npmArgs) {
  const isWin = process.platform === "win32"
  const opts = { encoding: "utf-8", stdio: "pipe", timeout: 20000 }
  return isWin
    ? execFileSync("cmd.exe", ["/c", "npm", ...npmArgs], opts)
    : execFileSync("npm", npmArgs, opts)
}

function readLocalVersion() {
  try { return JSON.parse(readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8")).version } catch { return null }
}

function semverGt(a, b) {
  const pa = String(a).replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) }
  return false
}

/**
 * `update` — checa a versão instalada vs a última no npm e orienta a atualização
 * (1 comando). `--run` executa de fato; `--json` saída-máquina.
 */
export async function updateCommand(args = [], opts = {}) {
  const json = args.includes("--json")
  const exec = opts.exec || defaultNpmExec
  const local = opts.localVersion || readLocalVersion()
  let latest = null
  try { latest = String(exec(["view", PKG, "version"]) || "").trim() } catch { latest = null }
  const updateAvailable = !!(latest && local && semverGt(latest, local))

  const result = { local, latest, updateAvailable, command: UPDATE_CMD, steps: [UPDATE_STEP_INSTALL, UPDATE_STEP_REFRESH] }
  if (json) { process.stdout.write(JSON.stringify(result) + "\n"); return result }

  section("gstack_vibehard update")
  info(`Versão instalada: ${local || "?"}`)
  info(`Última no npm:    ${latest || "(não consegui consultar — sem rede?)"}`)
  if (updateAvailable) {
    warn(`Atualização disponível: ${local} → ${latest}`)
    info("Atualize rodando os DOIS comandos (funciona em PowerShell, cmd e bash):")
    info(`  1) ${UPDATE_STEP_INSTALL}`)
    info(`  2) ${UPDATE_STEP_REFRESH}`)
    if (args.includes("--run")) {
      info("Executando a atualização...")
      try { exec(["install", "-g", `${PKG}@latest`]); success("Pacote atualizado. Agora rode `gstack_vibehard install` para refrescar os hooks.") }
      catch (e) { warn(`Falha ao atualizar: ${e.message}. Rode manualmente: ${UPDATE_STEP_INSTALL}  (depois)  ${UPDATE_STEP_REFRESH}`) }
    }
  } else if (latest) {
    success(`Você já está na versão mais recente (${local}).`)
  } else {
    info(`Para atualizar quando quiser: ${UPDATE_CMD}`)
  }
  return result
}
