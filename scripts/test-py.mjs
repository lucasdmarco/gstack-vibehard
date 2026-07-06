#!/usr/bin/env node
import { spawnSync } from "node:child_process"

/**
 * `npm run test:py` sem ruído (revisão pós-PRD25): antes, `pytest || unittest`
 * imprimia "No module named pytest" ANTES do fallback — parecia erro em máquina
 * sem pytest. Aqui o fallback é silencioso e SÓ acontece quando o pytest está
 * AUSENTE; falha real de teste do pytest propaga (nunca re-roda em unittest,
 * senão mascararia/duplicaria).
 */

const py = process.platform === "win32" ? "python" : "python3"
const run = (args, opts = {}) => spawnSync(py, args, { stdio: opts.stdio || "inherit", encoding: "utf-8", ...opts })

// pytest presente? (probe silencioso — nada vai ao terminal)
const probe = run(["-m", "pytest", "--version"], { stdio: "pipe" })
const hasPytest = probe.status === 0

const result = hasPytest
  ? run(["-m", "pytest", "tests/", "-q"])
  : run(["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"])

if (!hasPytest) console.log("[test:py] pytest ausente — rodou via unittest (instale pytest para output -q)")
process.exit(result.status ?? 1)
