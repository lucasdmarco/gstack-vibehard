import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * PRD51 DOD.13 — "todo `--json` anunciado gera stdout JSON puro".
 *
 * A lacuna nunca foi falta de teste: era falta da PERGUNTA. A pureza vinha sendo provada
 * comando a comando, onde alguém lembrou, e nada respondia "quantos anunciam `--json` e
 * quantos foram verificados?". Sem essa conta, cobertura parcial é indistinguível de
 * cobertura total — e foi assim que 25 anunciantes conviveram com um punhado de provas.
 *
 * O guard que mais importa aqui não é a varredura em si: é `unaccountedCommands()`. Ele
 * garante que um comando novo com `--json` não possa entrar sem que alguém decida como
 * prová-lo (receita) ou por que não dá para provar automaticamente (exclusão com motivo).
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const bin = path.join(repoRoot, "src", "index.js")
const mod = path.join(repoRoot, "src", "meta", "json-contract.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

function runCli(args, cwd) {
  try {
    return { code: 0, out: execFileSync("node", [bin, ...args], { cwd, encoding: "utf-8", stdio: "pipe", timeout: 120000 }) }
  } catch (e) {
    return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + "" }
  }
}

test("INVARIANTE: nenhum comando que anuncia `--json` fica sem receita NEM exclusão declarada", async () => {
  const { unaccountedCommands } = await imp()
  assert.deepEqual(unaccountedCommands(), [], "anunciar --json obriga a decidir como prová-lo")
})

test("toda exclusão registra MOTIVO real — a lista não pode virar depósito", async () => {
  const { SWEEP_EXCLUSIONS } = await imp()
  for (const [cmd, motivo] of Object.entries(SWEEP_EXCLUSIONS)) {
    assert.ok(motivo && motivo.length > 60, `${cmd} explica por que não é varrido automaticamente`)
  }
})

test("a lista de anunciantes é DERIVADA do registry da CLI, não mantida à mão", async () => {
  const { commandsAdvertisingJson } = await imp()
  const sintetico = [
    { name: "com-json", usage: "gstack_vibehard com-json [--json]" },
    { name: "sem-json", usage: "gstack_vibehard sem-json" },
  ]
  assert.deepEqual(commandsAdvertisingJson(sintetico), ["com-json"], "deriva do usage real")
  assert.ok(commandsAdvertisingJson().length > 10, "no registry real, dezenas anunciam --json")
})

test("cobertura é reportada com números reais (varridos + excluídos == anunciados)", async () => {
  const { jsonContractCoverage } = await imp()
  const c = jsonContractCoverage()
  assert.equal(c.swept + c.excluded, c.advertised, "a conta fecha — nada some no meio")
  assert.ok(c.swept > 0)
})

// A varredura real. Cada receita roda num tmpdir: nada toca o repositório nem o HOME.
test("VARREDURA: todo comando com receita emite JSON parseável em stdout", async (t) => {
  const { SWEEP_RECIPES, lastJsonLine } = await imp()
  const falhas = []
  for (const [cmd, args] of Object.entries(SWEEP_RECIPES)) {
    const cwd = mkdtempSync(path.join(tmpdir(), "gstack-jsonsweep-"))
    try {
      const r = runCli(args, cwd)
      const parsed = lastJsonLine(r.out)
      if (parsed === null) falhas.push(`${cmd}: nenhuma linha de stdout parseia como JSON (exit ${r.code})`)
      else if (typeof parsed !== "object") falhas.push(`${cmd}: JSON emitido não é objeto`)
    } finally { cleanupTmp(cwd) }
  }
  assert.deepEqual(falhas, [], `contrato --json quebrado em: ${falhas.join(" | ")}`)
})
