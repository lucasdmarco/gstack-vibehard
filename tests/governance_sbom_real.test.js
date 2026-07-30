import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { cleanupTmp } from "./helpers/tmp.js"
import { tmpdir } from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")

/**
 * PRD51 S51.6.6 — controle negativo REAL do claim `governance` (SBOM).
 *
 * Achado: `tests/governance.test.js` só verifica presença de arquivo/string
 * (SECURITY.md/THREAT_MODEL.md/`"sbom"` no package.json) — o mesmo tipo de
 * checagem que o próprio Dream Auditor já faz. Nenhum teste jamais RODAVA
 * `npm sbom` de verdade nem provava que ele FALHA quando o projeto não tem
 * um manifesto válido. Este teste roda o comando real (não `npm run sbom`,
 * que mistura o header do npm no stdout — chama `npm sbom` direto) e prova
 * os dois lados: sucesso produz CycloneDX bem-formado; ausência de
 * package.json válido FALHA de verdade (não é um comando que sempre "passa").
 */

// PRD26/testes existentes (runtime_e2e.test.js): npm.cmd não spawna com
// shell:false no Windows — mesmo padrão de test-pack.mjs/test-e2e-lifecycle.mjs.
const isWin = process.platform === "win32"

function runNpmSbom(cwd, opts = {}) {
  const args = ["sbom", "--sbom-format", "cyclonedx", "--omit", "dev"]
  return isWin
    ? execFileSync("cmd.exe", ["/c", "npm", ...args], { cwd, encoding: "utf-8", ...opts })
    : execFileSync("npm", args, { cwd, encoding: "utf-8", ...opts })
}

test("npm sbom --sbom-format cyclonedx: produz CycloneDX 1.5 bem-formado do package real", () => {
  const out = runNpmSbom(repoRoot, { timeout: 60000 })
  const bom = JSON.parse(out)
  assert.equal(bom.bomFormat, "CycloneDX")
  assert.equal(bom.specVersion, "1.5")
  assert.equal(bom.metadata.component.name, "gstack_vibehard")
  assert.ok(Array.isArray(bom.components), "SBOM lista componentes (dependências reais)")
})

// CONTROLE NEGATIVO real: prova que o gate FALHA quando não há manifesto
// válido (npm precisa de um "version" real, não um range, pra gerar um PURL) —
// não é um comando decorativo que sempre emite algo bem-formado.
test("CONTROLE NEGATIVO: npm sbom FALHA (exit != 0, sem JSON válido) sem package.json válido no diretório", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "gstack-sbom-neg-"))
  try {
    // sem package.json algum -> npm trata o dir como pacote implícito sem
    // version fixada (range), e recusa gerar PURL -> falha real, não vazia.
    let threw = false
    let output = ""
    try {
      output = runNpmSbom(tmp, { timeout: 30000 })
    } catch (e) {
      threw = true
      output = String(e.stdout || "") + String(e.stderr || "")
    }
    assert.ok(threw, "npm sbom deveria falhar (exit != 0) sem manifesto válido")
    let parsedOk = true
    try { JSON.parse(output) } catch { parsedOk = false }
    assert.ok(!parsedOk, "a saída de falha não deveria ser um CycloneDX JSON válido")
  } finally { cleanupTmp(tmp) }
})

// Controle positivo complementar: com um package.json MÍNIMO mas VÁLIDO
// (version fixa), o gate volta a passar — prova que o requisito é
// especificamente "manifesto com version pinada", não "estar num dir vazio".
test("npm sbom passa com package.json mínimo mas válido (version pinada)", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "gstack-sbom-pos-"))
  try {
    writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "sbom-min-fixture", version: "1.0.0" }))
    const out = runNpmSbom(tmp, { timeout: 30000 })
    const bom = JSON.parse(out)
    assert.equal(bom.bomFormat, "CycloneDX")
    assert.equal(bom.metadata.component.version, "1.0.0", "version pinada do fixture aparece no SBOM")
  } finally { cleanupTmp(tmp) }
})
