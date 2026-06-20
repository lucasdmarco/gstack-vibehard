#!/usr/bin/env node
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { runCLI } from "./cli/index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"))

const args = process.argv.slice(2)

if (args[0] === "--version" || args[0] === "-v") {
  console.log(pkg.version)
  process.exit(0)
}

// IMPORTANTE: no-args NÃO instala. `runCLI(undefined, ...)` mostra ajuda segura
// e sugere `start` (first-run sem medo). Help/instalação são decididos lá.
runCLI(args[0], args.slice(1))
