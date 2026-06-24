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
