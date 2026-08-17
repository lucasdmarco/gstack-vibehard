#!/usr/bin/env node
// Pack smoke (PRD finalprd10 P0.7): prova que o TARBALL npm funciona — não a
// árvore-fonte. Empacota, inspeciona o conteúdo, instala o .tgz num projeto temp
// e chama o BIN INSTALADO (--version/--help/doctor --json/install --audit-only).
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const isWin = process.platform === "win32"
let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { console.error(`  ✗ ${m}`); failures++ }

// Cache npm ISOLADO (PRD41 S41.0 / P2.1): o cache global compartilhado dá EPERM no
// Windows quando outra coisa o toca em paralelo. Um cache dedicado por execução
// torna o pack smoke determinístico e a falha diagnosticável (nunca ambiental).
const npmCache = mkdtempSync(join(tmpdir(), "gstack-npmcache-"))

// npm via cmd.exe no Windows (.cmd shim dá EINVAL no execFileSync direto).
function npm(args, opts = {}) {
  const base = {
    encoding: "utf-8", stdio: "pipe", timeout: 180000, ...opts,
    env: { ...process.env, npm_config_cache: npmCache, ...(opts.env || {}) },
  }
  return isWin ? execFileSync("cmd.exe", ["/c", "npm", ...args], base) : execFileSync("npm", args, base)
}
function node(args, opts = {}) {
  return execFileSync(process.execPath, args, { encoding: "utf-8", stdio: "pipe", timeout: 60000, ...opts })
}

console.log("== pack smoke ==")
const work = mkdtempSync(join(tmpdir(), "gstack-pack-"))
try {
  // 1) npm pack (dispara prepack/clean-pkg). --json lista o tarball.
  const meta = JSON.parse(npm(["pack", "--json", "--pack-destination", work], { cwd: repoRoot }))
  const entry = Array.isArray(meta) ? meta[0] : meta
  const tgz = join(work, entry.filename.split("/").pop())
  if (!existsSync(tgz)) { bad(`tarball não criado: ${tgz}`); throw new Error("no tarball") }
  ok(`tarball criado: ${entry.filename} (${entry.files.length} arquivos)`)

  // 2) conteúdo do tarball NÃO pode ter lixo
  const files = entry.files.map((f) => f.path)
  const junk = files.filter((p) => /(^|\/)(node_modules|\.git)\/|__pycache__|\.pyc$|\.pyo$|\.pytest_cache|\.tgz$/.test(p))
  if (junk.length) bad(`tarball contém lixo: ${junk.slice(0, 5).join(", ")}`)
  else ok("tarball sem node_modules/__pycache__/.pyc/.tgz")

  // 3) instala o .tgz num projeto temp e chama o BIN INSTALADO (via node no entry do pacote)
  const proj = join(work, "consumer")
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "consumer", private: true, version: "1.0.0" }))
  npm(["install", "--no-audit", "--no-fund", "--silent", tgz], { cwd: proj })
  const installedDir = join(proj, "node_modules", "@gstack-vibehard", "installer")
  const entryJs = join(installedDir, "src", "index.js")
  if (!existsSync(entryJs)) { bad(`pacote instalado sem src/index.js: ${entryJs}`); throw new Error("no entry") }
  ok(`pacote instalado: v${JSON.parse(readFileSync(join(installedDir, "package.json"), "utf-8")).version}`)
  // shim do bin também existe?
  const binShim = join(proj, "node_modules", ".bin", isWin ? "gstack_vibehard.cmd" : "gstack_vibehard")
  if (existsSync(binShim)) ok("bin shim instalado em node_modules/.bin")

  const call = (args) => node([entryJs, ...args], { cwd: proj, env: { ...process.env, NO_COLOR: "1" } })
  const ver = call(["--version"]).trim()
  if (/^\d+\.\d+\.\d+/.test(ver)) ok(`--version → ${ver}`)
  else bad(`--version inesperado: ${ver}`)
  const help = call(["--help"])
  if (help.includes("Comando desconhecido")) bad("--help diz 'Comando desconhecido'")
  else ok("--help OK (exit 0)")
  try { JSON.parse(call(["doctor", "--json"])); ok("doctor --json é JSON puro") }
  catch { bad("doctor --json não é JSON puro") }
  try { call(["install", "--audit-only"]); ok("install --audit-only roda (read-only)") }
  catch (e) { bad(`install --audit-only falhou: ${(e.message || "").slice(0, 80)}`) }

  // 4) FATIA 7 — o inventário i18n sobrevive à instalação, e o TypeScript não vem junto.
  //
  // O engine de AST (`scripts/lib/i18n-js-ast.mjs`) importa `typescript`, que é
  // devDependency, e VIAJA no tarball porque `files` inclui `scripts/`. Isso é
  // aceitável enquanto nada em runtime o carregar — o registry é JSON inerte, e o
  // runtime lê dado, nunca AST. Aqui essa promessa deixa de ser comentário.
  const temTs = existsSync(join(proj, "node_modules", "typescript"))
    || existsSync(join(installedDir, "node_modules", "typescript"))
  if (temTs) bad("TypeScript foi instalado junto — devDependency vazou para o consumidor")
  else ok("TypeScript AUSENTE na instalação (devDependency não vaza)")

  // CONTROLE POSITIVO da ausência: sem ele, "nada carrega o engine" seria
  // verdade vazia — poderia ser que o engine carregasse e o `typescript`
  // estivesse lá. Carregá-lo de propósito PRECISA falhar.
  const engine = join(installedDir, "scripts", "lib", "i18n-js-ast.mjs").replaceAll("\\", "/")
  let carregou = false
  try {
    node(["--input-type=module", "-e", `await import("file:///${engine}")`], { cwd: proj })
    carregou = true
  } catch (e) {
    const msg = `${e.stderr || ""}${e.message || ""}`
    if (/ERR_MODULE_NOT_FOUND|Cannot find package 'typescript'/.test(msg)) {
      ok("controle positivo: carregar o engine de AST FALHA por falta de typescript")
    } else bad(`engine falhou por outro motivo: ${msg.slice(0, 120)}`)
  }
  if (carregou) bad("o engine de AST carregou sem typescript — a separação build/runtime não é real")

  // O inventário, pela URL CANÔNICA do módulo instalado: sem `?t=` de
  // cache-busting, que é truque de teste e esconderia um módulo que só funciona
  // quando reimportado. É assim que um consumidor o carregaria.
  const inv = join(installedDir, "src", "meta", "i18n-inventory.js").replaceAll("\\", "/")
  try {
    const saida = node(["--input-type=module", "-e", `
      const m = await import("file:///${inv}")
      const r = m.buildInventory({ repoRoot: ${JSON.stringify(installedDir.replaceAll("\\", "/"))} })
      process.stdout.write(JSON.stringify({
        total: r.points.length, registry: r.jsRegistry.status, ok: r.jsRegistry.ok,
      }))
    `], { cwd: proj })
    const r = JSON.parse(saida)
    if (r.total > 0 && r.ok === true && r.registry === "fresh") {
      ok(`inventário instalado funciona: ${r.total} pontos, registry ${r.registry}`)
    } else bad(`inventário instalado degradado: ${saida}`)
  } catch (e) {
    bad(`inventário não roda instalado: ${((e.stderr || e.message) || "").slice(0, 160)}`)
  }
} catch (e) {
  bad(`erro fatal: ${e.message}`)
} finally {
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* cleanup */ }
  try { rmSync(npmCache, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* cleanup */ }
}

if (failures > 0) { console.error(`\npack smoke: ${failures} falha(s)`); process.exit(1) }
console.log("\npack smoke: OK")
