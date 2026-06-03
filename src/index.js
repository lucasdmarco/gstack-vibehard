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

const command = args[0] || "install"
runCLI(command, args.slice(1))
