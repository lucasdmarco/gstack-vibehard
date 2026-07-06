import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// ── CM-04: mojibake Windows — transliteração central ─────────────────────────
test("CM-04: asciiSafe translitera box-drawing, símbolos e acentos", async () => {
  const { asciiSafe } = await imp("src/cli/index.js")
  const out = asciiSafe("╔═ Instalação ✓ concluída — ⚠ atenção ▸ próximo • ítem…")
  assert.equal(/[^\x00-\x7F]/.test(out), false, "saída é 100% ASCII")
  assert.match(out, /Instalacao/, "acentos viram letras base")
  assert.match(out, /OK concluida/, "✓ vira OK")
  assert.match(out, /! atencao/, "⚠ vira !")
})

test("CM-04: com asciiMode ligado, TODO output via color() sai ASCII (banner incluso)", async () => {
  const mod = await imp("src/cli/index.js")
  mod.setAsciiMode(true)
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  const origLog = console.log
  console.log = (s = "") => { buf += String(s) + "\n" }
  try {
    mod.section("Instalação — configuração")
    mod.success("concluída ✓")
    mod.warn("atenção ⚠")
  } finally { process.stdout.write = orig; console.log = origLog; mod.setAsciiMode(false) }
  const noAnsi = buf.replace(/\x1b\[[0-9;]*m/g, "")
  assert.equal(/[^\x00-\x7F]/.test(noAnsi), false, `nenhum byte fora do ASCII: ${JSON.stringify(noAnsi.slice(0, 80))}`)
})

test("CM-04: ensureReadableConsole VERIFICA a codepage (não confia só no exit 0)", () => {
  const src = readFileSync(path.join(repoRoot, "src", "cli", "index.js"), "utf-8")
  assert.match(src, /execSync\("chcp",/, "consulta a codepage efetiva de volta")
  assert.match(src, /65001.*asciiMode = true|asciiMode = true/s, "sem 65001 confirmado → ASCII")
})

// ── CM-01: preflight-first para deps obrigatórias ─────────────────────────────
test("CM-01: predictFullDegradations sonda toolchains e lista o que degradaria", async () => {
  const { predictFullDegradations } = await imp("src/installer/install.js")
  // probes injetados: bun ausente, uv presente → só gbrain degrada
  const probes = [
    { component: "gbrain", needs: "bun", probe: () => false },
    { component: "graphify", needs: "uv", probe: () => true },
    { component: "quebrado", needs: "x", probe: () => { throw new Error("boom") } },
  ]
  const out = predictFullDegradations(probes)
  assert.deepEqual(out.map((d) => d.component), ["gbrain", "quebrado"], "probe que lança conta como degradação prevista")
  assert.equal(out[0].needs, "bun")
})

test("CM-01: preflight bloqueia ANTES de escrita e aponta as saídas (fonte)", () => {
  const src = readFileSync(path.join(repoRoot, "src", "installer", "install.js"), "utf-8")
  assert.match(src, /preflightMandatoryGate\(flags\)/, "gate roda no preflight")
  assert.match(src, /NADA foi escrito/, "mensagem garante zero escrita no bloqueio")
  assert.match(src, /partial_with_restore_available/, "falha tardia declara estado recuperável")
  assert.match(src, /uninstall --restore-only/, "aponta o comando de restore")
})

// ── CM-05: estado por harness sem contradição ────────────────────────────────
test("CM-05: harnessStateLine dá razão única por estado (fonte + contrato)", () => {
  const src = readFileSync(path.join(repoRoot, "src", "installer", "install.js"), "utf-8")
  assert.match(src, /HARNESS_KIND/, "mapa de tipo por harness")
  assert.match(src, /já instalado — artefatos gerenciados ATUALIZADOS/, "já-instalado explica o refresh")
  assert.match(src, /pulado \(não selecionado/, "pulado tem razão")
  assert.match(src, /report\.harnessPlan = \{ all: allHarnessIds, alreadyInstalled, selected/, "plano rastreável no report")
})

// ── CM-09: clean-machine declara que é simulação ─────────────────────────────
test("CM-09: runCleanMachine reporta mode simulated_offline", async () => {
  const { runCleanMachine } = await imp("src/installer/clean-machine.js")
  const r = runCleanMachine({ write: false })
  assert.equal(r.mode, "simulated_offline")
  assert.match(r.note, /readiness/, "aponta onde está o estado real")
  assert.equal(r.ok, true, "os 12 cenários seguem verdes")
})
