#!/usr/bin/env node
import { runCLI } from "./cli/index.js"

const args = process.argv.slice(2)
const command = args[0] || "install"

runCLI(command, args.slice(1))
