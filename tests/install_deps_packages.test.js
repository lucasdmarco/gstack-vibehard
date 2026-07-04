import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

// Guarda de regressão dos nomes de pacote reais (bugs que custaram caro):
//  - graphify é publicado como `graphifyy` (2 "y") no PyPI; `graphify` dava E404.
//  - `cli-anything-hub` NUNCA existiu no npm (E404) — era nome fantasma; o real é
//    o Printing Press (Go) via o comando `tools`.
const installSrc = readFileSync(path.join(import.meta.dirname, "..", "src", "installer", "install.js"), "utf-8")

test("install instala graphify pelo pacote correto `graphifyy` (não `graphify`)", () => {
  assert.match(installSrc, /tool",\s*"install",\s*"graphifyy"|"graphifyy"/, "usa graphifyy no uv tool install")
  assert.doesNotMatch(installSrc, /tool",\s*"install",\s*"graphify"\s*\]/, "não usa o nome errado `graphify` (E404)")
})

test("install NÃO tenta mais o pacote fantasma `cli-anything-hub` (E404)", () => {
  assert.doesNotMatch(installSrc, /install",\s*"-g",\s*"cli-anything-hub"/, "removido o npm install -g cli-anything-hub")
})

test("install --yes instala o ECC global (ecc-universal) — consistência Full = tudo", () => {
  assert.match(installSrc, /"ecc-universal"/, "install instala ecc-universal (binário `ecc`)")
})

const createSrc = readFileSync(path.join(import.meta.dirname, "..", "src", "cli", "create.js"), "utf-8")

test("create instala ECC pelo pacote real `ecc-universal` (não o daemon fantasma ecc2)", () => {
  assert.match(createSrc, /"ecc-universal"/, "instala ecc-universal via npm")
  assert.doesNotMatch(createSrc, /gstack-dev\/ecc2/, "sem o repo fantasma gstack-dev/ecc2 (404)")
  assert.doesNotMatch(createSrc, /"ecc2",\s*\["daemon",\s*"start"\]/, "sem `ecc2 daemon start` fantasma")
})

test("create instala Atomic da fonte real atomicdotdev/atomic (não do domínio morto)", () => {
  assert.match(createSrc, /atomicdotdev\/atomic/, "usa o repo real do Atomic")
  assert.doesNotMatch(createSrc, /atomic-vcs\.dev/, "sem o domínio morto atomic-vcs.dev")
})

test("install: MCP global é OPT-OUT no completo (--no-global-mcp), não mais opt-in", () => {
  assert.match(installSrc, /globalMcp\s*[:=]\s*!projectOnly\s*&&\s*!args\.includes\("--no-global-mcp"\)/, "Full escreve MCP global por padrão; opt-out --no-global-mcp")
})

test("install: Full tenta instalar o app Obsidian (winget/brew) com opt-out --no-obsidian", () => {
  assert.match(installSrc, /Obsidian\.Obsidian/, "winget instala o app Obsidian no completo")
  assert.match(installSrc, /--no-obsidian/, "opt-out --no-obsidian")
})
