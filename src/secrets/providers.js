import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { homedir } from "os"

/**
 * Providers de segredo por SO (PRD 12 §10). O VALOR fica no keychain do SO; o
 * gstack guarda só nomes/metadados. Windows: DPAPI (chave do usuário, externa ao
 * arquivo) via PowerShell. macOS: Keychain (`security`). Linux: Secret Service
 * (`secret-tool`/libsecret). `run` é injetável para teste.
 *
 * Superfície do VALOR por SO (honesto, não sobre-promete):
 *  - Windows (DPAPI) e Linux (secret-tool): valor entra por STDIN — não aparece
 *    em argv nem na lista de processos.
 *  - macOS (`security add-generic-password -w <valor>`): a ferramenta do sistema
 *    NÃO lê a senha de STDIN de forma não-interativa, então o valor vai em argv.
 *    RESÍDUO CONHECIDO: por ~milissegundos, outro usuário LOCAL no mesmo Mac pode
 *    vê-lo via `ps`. Irrelevante num Mac de usuário único (o caso comum); num Mac
 *    multiusuário é exposição real. Correção recomendada: `security -i` lendo o
 *    subcomando (com o valor) de STDIN — ver AUDITS/security-audit-v3.36.md
 *    (SEC-01). Não aplicada aqui sem verificação em macOS para não regredir o
 *    armazenamento de segredo dos usuários existentes.
 *
 * Interface: { id, isAvailable(), set(ns,name,value), get(ns,name)->str|null, delete(ns,name) }
 */

function defaultRun(file, args, opts = {}) {
  return execFileSync(file, args, {
    input: opts.input,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: opts.timeout || 8000,
    windowsHide: true,
  })
}

export function vaultBase() { return join(homedir(), ".gstack", "secrets") }

/** Sonda benigna de disponibilidade (sem `--version`, que PowerShell/security não têm). */
function probe(run, file, args) {
  try { run(file, args, { timeout: 4000 }); return true } catch { return false }
}

// ── Windows: DPAPI (ConvertFrom/ConvertTo-SecureString) — blob cifrado em arquivo ──
function dpapiProvider(run) {
  const dir = (ns) => join(vaultBase(), ns)
  const file = (ns, name) => join(dir(ns), `${name}.dpapi`)
  return {
    id: "windows-dpapi",
    isAvailable() { return process.platform === "win32" && probe(run, "powershell", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"]) },
    set(ns, name, value) {
      mkdirSync(dir(ns), { recursive: true })
      const target = file(ns, name).replace(/'/g, "''")
      // valor por STDIN; cifra com a chave DPAPI do usuário; grava o blob
      run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        `$v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v -AsPlainText -Force; ConvertFrom-SecureString $s | Set-Content -NoNewline -Encoding ascii '${target}'`],
        { input: value })
    },
    get(ns, name) {
      const f = file(ns, name)
      if (!existsSync(f)) return null
      const target = f.replace(/'/g, "''")
      const out = run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        `$enc=Get-Content -Raw '${target}'; $s=ConvertTo-SecureString $enc; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)`])
      return out == null ? null : String(out).replace(/\r?\n$/, "")
    },
    delete(ns, name) { try { rmSync(file(ns, name), { force: true }) } catch { /* ok */ } },
  }
}

// ── macOS: Keychain via `security` ──
function macKeychainProvider(run) {
  const acct = "gstack_vibehard"
  const svc = (ns, name) => `gstack:${ns}:${name}`
  return {
    id: "macos-keychain",
    isAvailable() { return process.platform === "darwin" && probe(run, "security", ["list-keychains"]) },
    set(ns, name, value) {
      // RESÍDUO CONHECIDO (SEC-01): `security` não lê a senha de STDIN não-interativo;
      // o valor vai em argv. Aceitável em Mac de usuário único; ver docstring/audit.
      run("security", ["add-generic-password", "-U", "-a", acct, "-s", svc(ns, name), "-w", value])
    },
    get(ns, name) {
      try {
        const out = run("security", ["find-generic-password", "-a", acct, "-s", svc(ns, name), "-w"])
        return out == null ? null : String(out).replace(/\r?\n$/, "")
      } catch { return null }
    },
    delete(ns, name) { try { run("security", ["delete-generic-password", "-a", acct, "-s", svc(ns, name)]) } catch { /* ok */ } },
  }
}

// ── Linux: Secret Service via `secret-tool` (valor por STDIN) ──
function libsecretProvider(run) {
  return {
    id: "linux-libsecret",
    isAvailable() { return process.platform === "linux" && probe(run, "secret-tool", ["--version"]) },
    set(ns, name, value) {
      run("secret-tool", ["store", "--label", `gstack ${ns} ${name}`, "gstack_ns", ns, "gstack_name", name], { input: value })
    },
    get(ns, name) {
      try {
        const out = run("secret-tool", ["lookup", "gstack_ns", ns, "gstack_name", name])
        return out == null || out === "" ? null : String(out).replace(/\r?\n$/, "")
      } catch { return null }
    },
    delete(ns, name) { try { run("secret-tool", ["clear", "gstack_ns", ns, "gstack_name", name]) } catch { /* ok */ } },
  }
}

/** Provider do SO atual (ou null se nenhum keychain disponível). `run` injetável. */
export function detectProvider(opts = {}) {
  const run = opts.run || defaultRun
  const all = [dpapiProvider(run), macKeychainProvider(run), libsecretProvider(run)]
  if (opts.force) return all.find((p) => p.id === opts.force) || null
  return all.find((p) => p.isAvailable()) || null
}

export { dpapiProvider, macKeychainProvider, libsecretProvider, defaultRun }
