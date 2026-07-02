import { spawn } from "child_process"
import { existsSync, readFileSync, renameSync } from "fs"
import { join } from "path"
import readline from "readline"
import { section, success, warn, error, info } from "../cli/index.js"
import {
  brokerStatus, setSecret, deleteSecret, listSecretNames, resolveSecrets, parseDotEnv,
} from "../secrets/broker.js"
import { loadSecretsSchema, allRequiredNames, requiredSecretsForService } from "../secrets/schema.js"
import { loadRuntimeManifest } from "../runtime/manifest.js"

/** Prompt SEM echo (segredo não aparece na tela). Injetável via opts.readValue. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    let first = true
    rl._writeToOutput = (s) => { if (first) { rl.output.write(question); first = false } } // mascara o digitado
    rl.question(question, (val) => { rl.close(); process.stdout.write("\n"); resolve(val) })
  })
}

async function askYesNo(question, opts) {
  if (opts.yes) return true
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`${question} [s/N] `, (a) => { rl.close(); resolve(/^s(im)?$/i.test(a.trim())) })
  })
}

/** `gstack_vibehard secrets <sub>` — broker de segredos (keychain do SO). */
export async function secretsCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const sub = args.find((a) => !a.startsWith("-")) || "doctor"
  const json = args.includes("--json")
  const status = brokerStatus(opts)

  if (sub === "doctor") return doctorSecrets(cwd, status, json, opts)
  if (sub === "list") return listSecrets(cwd, json)
  if (sub === "set") return setCmd(cwd, args, status, opts)
  if (sub === "delete" || sub === "rm") return deleteCmd(cwd, args, opts)
  if (sub === "import") return importCmd(cwd, args, status, opts)
  if (sub === "run") return runCmd(cwd, args, status, opts)
  warn(`Subcomando desconhecido: ${sub}`)
  info("  Use: secrets <doctor|list|set|delete|import|run>")
}

function doctorSecrets(cwd, status, json, opts) {
  const schema = loadSecretsSchema(cwd)
  const required = allRequiredNames(schema)
  const stored = new Set(listSecretNames(cwd).map((s) => s.name))
  const missing = required.filter((n) => !stored.has(n))
  const report = {
    provider: status.provider, available: status.available,
    required, stored: [...stored], missing,
    ok: status.available && missing.length === 0,
  }
  if (json) { process.stdout.write(JSON.stringify(report) + "\n"); return report }
  section("secrets doctor")
  info(`  Provider: ${status.provider || "(nenhum keychain disponível)"} ${status.available ? "✓" : "✗"}`)
  if (!status.available) warn("  Sem keychain — no Full o broker é obrigatório; no Lite só ok se não houver segredo requerido.")
  if (required.length === 0) info("  Nenhum segredo requerido pelo schema.")
  else {
    for (const n of required) (stored.has(n) ? success : warn)(`  ${stored.has(n) ? "✓" : "•"} ${n}: ${stored.has(n) ? "guardado" : "FALTANDO — `secrets set " + n + "`"}`)
  }
  ;(report.ok ? success : warn)(report.ok ? "Broker pronto." : "Broker incompleto (veja acima).")
  return report
}

function listSecrets(cwd, json) {
  const names = listSecretNames(cwd)
  if (json) { process.stdout.write(JSON.stringify({ names }) + "\n"); return }
  section("secrets list")
  if (names.length === 0) { info("  (nenhum segredo guardado neste projeto)"); return }
  for (const s of names) info(`  • ${s.name}${s.sensitive === false ? "" : " 🔒"} — guardado em ${s.setAt || "?"}`) // NUNCA o valor
}

async function setCmd(cwd, args, status, opts) {
  const name = args.filter((a) => !a.startsWith("-"))[1]
  if (!name) { error("Uso: secrets set <NOME>"); return }
  if (!status.available) { error("Sem keychain disponível — não dá pra guardar com segurança."); return }
  const value = opts.readValue ? await opts.readValue(name)
    : args.includes("--stdin") ? readFileSync(0, "utf-8").replace(/\r?\n$/, "")
    : await promptHidden(`Valor de ${name} (não ecoa): `)
  if (!value) { warn("Valor vazio — abortado."); return }
  setSecret(cwd, name, value, opts)
  success(`Guardado ${name} no keychain (${status.provider}).`)
  // Fluxo de alto risco (PRD14 §6.6): com segredo em jogo, lembra a cobertura honesta
  // do Output Guard — padrão é auditoria pós-resposta; prevenção em trânsito é opt-in.
  info("  Output Guard padrão audita DEPOIS da resposta. Redação em trânsito (opt-in): `gstack_vibehard proxy` · `proxy status`.")
}

function deleteCmd(cwd, args, opts) {
  const name = args.filter((a) => !a.startsWith("-"))[1]
  if (!name) { error("Uso: secrets delete <NOME>"); return }
  deleteSecret(cwd, name, opts)
  success(`Removido ${name} (keychain + índice).`)
}

async function importCmd(cwd, args, status, opts) {
  const file = args.filter((a) => !a.startsWith("-"))[1] || join(cwd, ".env")
  if (!existsSync(file)) { error(`Arquivo não encontrado: ${file}`); return }
  if (!status.available) { error("Sem keychain — não importo segredo em claro."); return }
  const pairs = parseDotEnv(readFileSync(file, "utf-8"))
  const keys = Object.keys(pairs)
  if (keys.length === 0) { warn("Nenhuma variável encontrada no arquivo."); return }
  section(`secrets import — ${keys.length} variável(is) de ${file}`)
  for (const k of keys) { setSecret(cwd, k, pairs[k], opts); success(`  ✓ ${k} → keychain`) } // valores nunca impressos
  // PRD: .env lido uma vez, com confirmação antes de apagar/renomear
  if (await askYesNo(`Renomear ${file} para ${file}.imported (remove o segredo em claro)?`, opts)) {
    try { renameSync(file, `${file}.imported`); info(`  ${file} → ${file}.imported`) } catch (e) { warn(`Não renomeei: ${e.message}`) }
  } else info("  Mantido. Lembre: `.env` rastreado bloqueia delegação.")
}

/**
 * Comando de `secrets run`. O `--` é OPCIONAL: o shim `.cmd` do npm no Windows
 * ENGOLE o `--`, então não dá pra depender dele — `secrets run node x.js` vale igual
 * a `secrets run -- node x.js`. Pega tudo após `run` (ou após o `--`, se houver).
 */
export function parseRunArgs(args) {
  const runIdx = args.indexOf("run")
  const rest = runIdx >= 0 ? args.slice(runIdx + 1) : args.slice()
  const dd = rest.indexOf("--")
  return dd >= 0 ? rest.slice(dd + 1) : rest // verbatim (não filtra args do comando)
}

function runCmd(cwd, args, status, opts) {
  const cmd = parseRunArgs(args)
  if (cmd.length === 0) { error("Uso: secrets run [--] <comando> [args]"); return }
  const schema = loadSecretsSchema(cwd)
  const names = allRequiredNames(schema)
  const secrets = resolveSecrets(cwd, names, opts) // só os requeridos, EM MEMÓRIA
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd, stdio: "inherit", shell: false,
    env: { ...process.env, ...secrets }, // injeção só em memória; nunca logada
    windowsHide: true,
  })
  child.on("error", (e) => error(`Falha ao executar: ${e.code || e.message}`))
  child.on("exit", (code) => { if (code) process.exitCode = code })
}

export { promptHidden, requiredSecretsForService }
