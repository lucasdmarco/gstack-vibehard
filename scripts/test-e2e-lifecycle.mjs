#!/usr/bin/env node
// E2E lifecycle matrix (PRD 12 PR8). Prova o CICLO DE VIDA do produto PUBLICADO,
// cross-OS, em caixa-preta: empacota o tarball real → instala num projeto temp →
// roda o BIN INSTALADO num HOME DESCARTÁVEL pelo caminho doctor → dream audit →
// create → build(agents) → install --audit-only → uninstall, exigindo:
//   (1) o truth contract é o MESMO no tarball que no repo (18 REAL / 0 PLACEBO) — o
//       guard de integração do fix v3.21.1, agora cross-OS;
//   (2) ISOLAMENTO DE HOME: read-only é read-only; create é project-scoped (não
//       toca o HOME); install --audit-only --save-report grava EXATAMENTE 1 arquivo.
// GATED por env (CI liga): GSTACK_E2E_LIFECYCLE=1 npm run test:e2e:lifecycle
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const isWin = process.platform === "win32"
let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { console.error(`  ✗ ${m}`); failures++ }

if (!process.env.GSTACK_E2E_LIFECYCLE) {
  console.log("e2e lifecycle: GATED (defina GSTACK_E2E_LIFECYCLE=1 para rodar). OK")
  process.exit(0)
}

// npm via cmd.exe no Windows (.cmd shim dá EINVAL no execFileSync direto).
function npm(args, opts = {}) {
  const base = { encoding: "utf-8", stdio: "pipe", timeout: 300000, ...opts }
  return isWin ? execFileSync("cmd.exe", ["/c", "npm", ...args], base) : execFileSync("npm", args, base)
}

// snapshot recursivo de um diretório (caminhos relativos ordenados).
function listFiles(dir) {
  const out = []
  const walk = (d, rel) => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(join(d, e.name), r); else out.push(r)
    }
  }
  walk(dir, "")
  return out.sort()
}

// FOOTPRINT DO GSTACK no HOME: só os caminhos que o INSTALADOR é dono de escrever
// (configs de harness + seu relatório). Ignora caches de ferramentas terceiras que
// o sondamento de PMs materializa em $HOME (ex.: bun cria ~/.bun ao rodar `bun -v`)
// — isso é ruído do ambiente, não o produto vazando config global.
const GSTACK_PREFIXES = [".gstack_vibehard", ".claude", ".codex", ".cursor", ".config/opencode", ".config/gstack"]
function footprint(home) {
  return listFiles(home).filter((p) => GSTACK_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/")))
}

console.log(`== e2e lifecycle (${process.platform}/${process.arch}, node ${process.version}) ==`)
const work = mkdtempSync(join(tmpdir(), "gstack-e2e-life-"))
try {
  // 1) empacota e instala o TARBALL real num projeto consumidor
  const meta = JSON.parse(npm(["pack", "--json", "--pack-destination", work], { cwd: repoRoot }))
  const entry = Array.isArray(meta) ? meta[0] : meta
  const tgz = join(work, entry.filename.split("/").pop())
  if (!existsSync(tgz)) { bad(`tarball não criado: ${tgz}`); throw new Error("no tarball") }
  ok(`tarball: ${entry.filename} (${entry.files.length} arquivos)`)

  const proj = join(work, "consumer")
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "consumer", private: true, version: "1.0.0" }))
  npm(["install", "--no-audit", "--no-fund", "--silent", tgz], { cwd: proj })
  const entryJs = join(proj, "node_modules", "@gstack-vibehard", "installer", "src", "index.js")
  if (!existsSync(entryJs)) { bad("pacote instalado sem src/index.js"); throw new Error("no entry") }
  const pkgVersion = JSON.parse(readFileSync(join(proj, "node_modules", "@gstack-vibehard", "installer", "package.json"), "utf-8")).version
  ok(`instalado: v${pkgVersion}`)

  // 2) HOME descartável: o bin nunca pode tocar fora dele
  const home = join(work, "home"); mkdirSync(home, { recursive: true })
  const ws = join(work, "ws"); mkdirSync(ws, { recursive: true })
  const baseEnv = {
    ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home,
    GSTACK_SKIP_PREFLIGHT: "1", GSTACK_SKIP_SIDE_EFFECTS: "1",
  }
  // chama o BIN INSTALADO (não a árvore-fonte) como subprocesso isolado.
  const call = (args, cwd = ws) =>
    execFileSync(process.execPath, [entryJs, ...args], { cwd, env: baseEnv, encoding: "utf-8", stdio: "pipe", timeout: 120000 })
  const tryCall = (args, cwd) => { try { return { out: call(args, cwd), code: 0 } } catch (e) { return { out: (e.stdout || "") + (e.stderr || ""), code: e.status ?? 1 } } }

  // 3) --version (bate com o pacote)
  const ver = call(["--version"]).trim()
  ver.startsWith(pkgVersion) ? ok(`--version → ${ver}`) : bad(`--version ${ver} ≠ pkg ${pkgVersion}`)

  // 4) doctor --json é JSON puro (read-only)
  try { JSON.parse(call(["doctor", "--json"])); ok("doctor --json é JSON puro") }
  catch { bad("doctor --json não é JSON puro") }

  // 5) GUARD do fix v3.21.1, cross-OS: truth contract no TARBALL == repo.
  // Expectativa DINÂMICA (o CI quebrou com REAL===18 hardcoded quando o score real
  // evoluiu p/ 20): o contrato é igualdade tarball==repo + zero PLACEBO, não um número.
  try {
    const audit = JSON.parse(call(["dream", "audit", "--json"]))
    const s = audit.summary || {}
    const repoAudit = JSON.parse(execFileSync(process.execPath, [join(repoRoot, "src", "index.js"), "dream", "audit", "--json"], { encoding: "utf8", timeout: 60000 }))
    const r = repoAudit.summary || {}
    if (s.PLACEBO === 0 && s.REAL === r.REAL && s.PARTIAL === r.PARTIAL) ok(`dream audit no tarball: REAL=${s.REAL} PLACEBO=0 (== repo)`)
    else bad(`dream audit no tarball divergiu: tarball REAL=${s.REAL}/PARTIAL=${s.PARTIAL}/PLACEBO=${s.PLACEBO} vs repo REAL=${r.REAL}/PARTIAL=${r.PARTIAL}`)
  } catch (e) { bad(`dream audit --json falhou no tarball: ${(e.message || "").slice(0, 80)}`) }

  // ...até aqui tudo deve ser READ-ONLY: nenhum artefato gstack no HOME.
  if (footprint(home).length === 0) ok("read-only real: zero footprint gstack após version/doctor/audit")
  else bad(`comando read-only escreveu config gstack: ${footprint(home).slice(0, 5).join(", ")}`)

  // 6) create é PROJECT-SCOPED: cria no workspace, NÃO no HOME
  const cr = tryCall(["create", "smoke-app", "--lite"], ws)
  const appDir = join(ws, "smoke-app")
  if (cr.code === 0 && existsSync(join(appDir, "package.json"))) ok("create --lite: scaffold no workspace")
  else bad(`create --lite falhou (code ${cr.code}): ${cr.out.slice(-160)}`)
  if (existsSync(join(appDir, ".gstack", "app.json"))) {
    const app = JSON.parse(readFileSync(join(appDir, ".gstack", "app.json"), "utf-8"))
    app.mode === "lite" ? ok("create: .gstack/app.json mode=lite") : bad(`mode inesperado: ${app.mode}`)
  } else bad("create: sem .gstack/app.json")
  if (footprint(home).length === 0) ok("create é project-scoped: zero footprint gstack no HOME")
  else bad(`create vazou config gstack no HOME: ${footprint(home).slice(0, 5).join(", ")}`)

  // 7) build: integridade do Agent Factory shipado (drift/hashes cross-OS — guarda o CRLF fix)
  const ag = tryCall(["agents", "check"], proj)
  ag.code === 0 ? ok("agents check: factory shipada íntegra (sem drift cross-OS)")
    : bad(`agents check falhou (code ${ag.code}): ${ag.out.slice(-160)}`)

  // 8) install --audit-only --save-report: grava EXATAMENTE 1 relatório, nada mais
  const before = footprint(home)
  const inst = tryCall(["install", "--audit-only", "--save-report"], ws)
  if (inst.code !== 0) bad(`install --audit-only falhou (code ${inst.code}): ${inst.out.slice(-160)}`)
  const novos = footprint(home).filter((p) => !before.includes(p))
  if (novos.length === 1 && novos[0].includes(".gstack_vibehard/install-report-")) ok("install --audit-only: só o relatório no HOME")
  else bad(`install --audit-only escreveu inesperado: ${JSON.stringify(novos)}`)

  // 9) uninstall --restore-only: seguro mesmo sem instalação prévia (não quebra)
  const un = tryCall(["uninstall", "--restore-only", "--yes"], ws)
  un.code === 0 ? ok("uninstall --restore-only --yes: seguro (exit 0)")
    : bad(`uninstall falhou (code ${un.code}): ${un.out.slice(-160)}`)
} catch (e) {
  bad(`erro fatal: ${e.message}`)
} finally {
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* cleanup */ }
}

if (failures > 0) { console.error(`\ne2e lifecycle: ${failures} falha(s)`); process.exit(1) }
console.log("\ne2e lifecycle: OK")
