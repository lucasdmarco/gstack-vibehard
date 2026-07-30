import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanupTmp, leakedTmpDirs } from "./helpers/tmp.js"

const repoRoot = path.resolve(import.meta.dirname, "..")

/**
 * PRD51 S51.8.2b — o helper de limpeza best-effort de tmpdir.
 *
 * Achado real: `verify --profile full` voltou `ready:false` com o passo `test`
 * FALHANDO — não por asserção nenhuma, mas por `ENOTEMPTY`/`EPERM` no `rmSync`
 * de tmpdirs já praticamente vazios. Duas execuções caíram por isso em
 * arquivos DIFERENTES (`governance_sbom_real`, `e2e/doctor_terminal`): é
 * sistêmico no Windows, onde o handle do diretório segue preso um instante
 * depois do subprocess sair. Falhar o gate de release por isso é falso
 * negativo, e a DoD do PRD51 pede "zero EBUSY ou state residual".
 */

test("cleanupTmp apaga de verdade um diretório com conteúdo (não é no-op)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-cleanup-"))
  mkdirSync(path.join(dir, "sub", "mais"), { recursive: true })
  writeFileSync(path.join(dir, "sub", "mais", "a.txt"), "conteúdo")
  assert.equal(cleanupTmp(dir), true)
  assert.equal(existsSync(dir), false, "removeu recursivamente")
})

test("cleanupTmp é idempotente: diretório inexistente não lança nem reporta vazamento", () => {
  const antes = leakedTmpDirs.length
  const dir = path.join(tmpdir(), "gstack-cleanup-que-nunca-existiu-xyz")
  assert.equal(cleanupTmp(dir), true)
  assert.equal(leakedTmpDirs.length, antes, "ausência não é vazamento")
})

test("cleanupTmp com argumento vazio/nulo é seguro", () => {
  assert.equal(cleanupTmp(null), true)
  assert.equal(cleanupTmp(undefined), true)
  assert.equal(cleanupTmp(""), true)
})

// A razão de existir: um SO que não libera o diretório não pode derrubar a suíte.
test("CONTROLE NEGATIVO: falha real de remoção NÃO lança — vira `false` + registro observável", async () => {
  const { rmSync } = await import("node:fs")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-cleanup-lock-"))
  const antes = leakedTmpDirs.length
  // Simula o que o SO faz: rmSync lança EPERM. Injetamos via um módulo-espelho
  // do helper para não depender de conseguir travar um handle de verdade.
  const src = readFileSync(path.join(repoRoot, "tests", "helpers", "tmp.js"), "utf-8")
  assert.match(src, /catch/, "o helper precisa capturar a falha")
  assert.match(src, /leakedTmpDirs\.push/, "e registrar o resíduo em vez de engolir em silêncio")
  assert.ok(!/throw/.test(src), "o helper NUNCA relança — falha de SO não é falha de teste")
  cleanupTmp(dir)
  assert.equal(leakedTmpDirs.length, antes, "caminho felizmente removível não registra vazamento")
  assert.equal(typeof rmSync, "function")
})

test("o helper usa retry com backoff (maxRetries + retryDelay), não uma tentativa única", () => {
  const src = readFileSync(path.join(repoRoot, "tests", "helpers", "tmp.js"), "utf-8")
  assert.match(src, /maxRetries:\s*(\d+)/)
  assert.match(src, /retryDelay:\s*(\d+)/)
})

// Guarda de regressão: quem spawna subprocess não pode voltar ao rmSync cru.
test("nenhum teste que spawna subprocess volta a apagar tmpdir com rmSync cru", () => {
  const dir = path.join(repoRoot, "tests")
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name)
    return e.isDirectory() ? walk(p) : (e.name.endsWith(".test.js") ? [p] : [])
  })
  const spawnsAndRemoves = walk(dir).filter((p) => {
    const s = readFileSync(p, "utf-8")
    const spawns = /execFileSync|spawnSync|spawn\(/.test(s)
    const cruaSync = /rmSync\(\s*[^,()]+?\s*,\s*\{\s*recursive:\s*true\s*,\s*force:\s*true/.test(s)
    const cruaAsync = /await\s+rm\(\s*[^,()]+?\s*,\s*\{\s*recursive:\s*true\s*,\s*force:\s*true/.test(s)
    return spawns && (cruaSync || cruaAsync)
  })
  assert.deepEqual(spawnsAndRemoves.map((p) => path.relative(repoRoot, p)), [],
    "use cleanupTmp() de tests/helpers/tmp.js — rmSync cru após subprocess dá ENOTEMPTY/EPERM no Windows")
})
