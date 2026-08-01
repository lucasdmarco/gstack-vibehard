#!/usr/bin/env node
// PRD51 S51.10.4 — gera a matriz de capacidades (5 faixas) e, com `--write`, substitui a
// seção correspondente no manual INTERNO entre marcadores.
//
// O manual guia o produto e NÃO faz parte dele: não entra no tarball (`files` do
// package.json é allowlist, sem `.docs/`), não é runtime de agente, não vai ao contexto
// padrão do usuário. Este gerador existe para que a seção seja REGENERADA a cada release
// em vez de reescrita à mão — foi a escrita à mão que deixou o manual preso na v5.19.0.
import { readFileSync, writeFileSync, existsSync } from "fs"
import { buildCapabilityBands, renderCapabilityBandsMarkdown } from "../src/meta/capability-bands.js"

const MANUAL = ".docs/PLANS/projetogstack.md"
const INICIO = "<!-- BEGIN capability-bands (gerado) -->"
const FIM = "<!-- END capability-bands (gerado) -->"

const cliVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version
const md = renderCapabilityBandsMarkdown(buildCapabilityBands(), cliVersion)

if (!process.argv.includes("--write")) {
  console.log(md)
  process.exit(0)
}

if (!existsSync(MANUAL)) {
  // `.docs/` é gitignored: fora da máquina do autor o manual simplesmente não existe.
  console.log(`– ${MANUAL} ausente (\`.docs/\` é gitignored) — nada a escrever.`)
  process.exit(0)
}

const texto = readFileSync(MANUAL, "utf-8")
const i = texto.indexOf(INICIO)
const f = texto.indexOf(FIM)
if (i === -1 || f === -1) {
  console.error(`✗ marcadores ausentes em ${MANUAL}. Insira uma vez:\n${INICIO}\n${FIM}`)
  process.exit(1)
}

const novo = texto.slice(0, i + INICIO.length) + "\n\n" + md + "\n" + texto.slice(f)
writeFileSync(MANUAL, novo)
console.log(`✓ ${MANUAL}: matriz de capacidades regenerada (CLI v${cliVersion}).`)
