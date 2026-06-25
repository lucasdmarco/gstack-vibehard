import { readFileSync } from "fs"

/**
 * Leitura de JSON tolerante a BOM. O PowerShell 5.1 (`Set-Content -Encoding utf8`)
 * e vários editores no Windows gravam UTF-8 COM BOM (EF BB BF); `JSON.parse` lança
 * no `﻿` inicial. Como muitos arquivos `.gstack/*.json` e configs de projeto
 * são editados à mão, removemos o BOM antes de parsear. `stripBom` é no-op em
 * arquivo limpo (seguro de aplicar em qualquer leitor).
 */
export function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Lê e parseia JSON tolerando BOM. Lança em JSON inválido (o caller decide o catch). */
export function readJsonFile(path, encoding = "utf-8") {
  return JSON.parse(stripBom(readFileSync(path, encoding)))
}
