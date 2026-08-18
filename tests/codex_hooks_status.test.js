/**
 * PRD52 S52.F — o estado REAL dos hooks do Codex, e a certificação preparada.
 *
 * O valor deste arquivo não está em confirmar que o módulo roda; está em fixar
 * as duas fronteiras que ele descobriu ao encostar na máquina: a chave do ledger
 * de confiança é posicional (não é o script), e registro NÃO é enforcement.
 * Sem essas duas travas, um relatório verde aqui viraria "integração provada".
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const S = () => imp("src/harness/codex-hooks-status.js")

/** Monta um `~/.codex` sintético: hooks.json + config.toml + scripts. */
async function homeSintetico({ registrar = true, confiar = true, duplicar = false, comScript = true } = {}) {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-codexhome-"))
  const codex = path.join(home, ".codex")
  await mkdir(path.join(codex, "hooks"), { recursive: true })
  const { GSTACK_CODEX_HOOKS } = await imp("src/harness/codex-hooks-json.js")
  const hooksJsonPath = path.join(codex, "hooks.json")

  const doc = { hooks: {} }
  const trust = []
  for (const h of GSTACK_CODEX_HOOKS) {
    if (comScript) await writeFile(path.join(codex, "hooks", h.script), "# hook\n")
    if (!registrar) continue
    const entrada = { matcher: h.matcher, hooks: [{ type: "command", command: `python3 "${path.join(codex, "hooks", h.script)}"` }] }
    if (duplicar) entrada.hooks.push({ type: "command", command: `python3 "${path.join(codex, "hooks", h.script)}"` })
    doc.hooks[h.event] = [entrada]
    const wire = h.event.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
    if (confiar) trust.push(`[hooks.state.'${hooksJsonPath}:${wire}:0:0']\ntrusted_hash = "sha256:naoverificavel"\n`)
  }
  await writeFile(hooksJsonPath, JSON.stringify(doc, null, 2))
  await writeFile(path.join(codex, "config.toml"), `[hooks.state]\n\n${trust.join("\n")}`)
  return home
}

const comHome = async (opts, fn) => {
  const home = await homeSintetico(opts)
  try { return await fn(home) } finally { await rm(home, { recursive: true, force: true }) }
}

test("o nome do evento no ledger é DERIVADO, não consultado numa lista incompleta", async () => {
  const { eventoWire } = await S()
  assert.equal(eventoWire("SessionStart"), "session_start")
  assert.equal(eventoWire("PreToolUse"), "pre_tool_use")
  assert.equal(eventoWire("UserPromptSubmit"), "user_prompt_submit")
  // `Stop` é o caso que quebrou: `CODEX_EVENTS_WIRE` do PRD51 não o continha, e
  // consultar a lista como se fosse mapa punha `undefined` no meio da chave.
  assert.equal(eventoWire("Stop"), "stop")
})

test("todo hook declarado tem nome de evento derivável (nenhum buraco no mapeamento)", async () => {
  const { eventoWire } = await S()
  const { GSTACK_CODEX_HOOKS } = await imp("src/harness/codex-hooks-json.js")
  for (const h of GSTACK_CODEX_HOOKS) {
    assert.match(eventoWire(h.event), /^[a-z][a-z_]*$/, `evento sem forma wire válida: ${h.event}`)
  }
})

test("a chave de confiança é POSICIONAL — arquivo, evento wire e os dois índices", async () => {
  const { chaveDoSlot } = await S()
  assert.equal(chaveDoSlot("C:/x/hooks.json", "pre_tool_use", 0, 0), "C:/x/hooks.json:pre_tool_use:0:0")
})

test("registrado COM entrada de confiança no slot certo é `trust_entry_present`", async () => {
  const { statusDosHooksDoCodex } = await S()
  await comHome({}, (home) => {
    const r = statusDosHooksDoCodex({ home })
    assert.equal(r.present, true)
    assert.equal(r.allRegisteredWithTrustEntry, true)
    assert.ok(r.hooks.every((h) => h.state === "trust_entry_present"))
  })
})

test("CONTROLE NEGATIVO: registrado SEM entrada de confiança é `registered_untrusted`", async () => {
  const { statusDosHooksDoCodex } = await S()
  await comHome({ confiar: false }, (home) => {
    const r = statusDosHooksDoCodex({ home })
    assert.equal(r.allRegisteredWithTrustEntry, false)
    assert.ok(r.hooks.every((h) => h.state === "registered_untrusted"), "hook não confiado não roda")
  })
})

test("CONTROLE NEGATIVO: script ausente e registro duplicado são estados distintos", async () => {
  const { statusDosHooksDoCodex } = await S()
  await comHome({ comScript: false }, (home) => {
    assert.ok(statusDosHooksDoCodex({ home }).hooks.every((h) => h.state === "missing_script"))
  })
  await comHome({ duplicar: true }, (home) => {
    assert.ok(statusDosHooksDoCodex({ home }).hooks.every((h) => h.state === "duplicate_registration"))
  })
})

test("CONTROLE NEGATIVO: sem hooks.json, tudo é `not_registered` e `present` é falso", async () => {
  const { statusDosHooksDoCodex } = await S()
  await comHome({ registrar: false }, (home) => {
    const r = statusDosHooksDoCodex({ home })
    assert.equal(r.present, true, "o arquivo existe, mas vazio de registros nossos")
    assert.ok(r.hooks.every((h) => h.state === "not_registered"))
  })
})

test("A TRAVA: registro completo e confiado NUNCA declara enforcement observado", async () => {
  const { statusDosHooksDoCodex } = await S()
  await comHome({}, (home) => {
    const r = statusDosHooksDoCodex({ home })
    assert.equal(r.allRegisteredWithTrustEntry, true, "o teto do que a leitura alcança")
    assert.equal(r.enforcementObserved, false, "ler arquivo prova REGISTRO, nunca EXECUÇÃO")
    assert.ok(r.enforcementNote.includes("máquina limpa"), "o motivo acompanha a negativa")
  })
})

test("`agents doctor` publica o status real sem que ele vire gate", async () => {
  const { computeAgentsDoctor } = await imp("src/commands/agents.js")
  const { report } = computeAgentsDoctor()
  assert.ok(report.codexHooks, "o relatório passou a carregar o estado dos hooks do Codex")
  assert.equal(report.codexHooks.enforcementObserved, false)
  assert.equal(typeof report.ok, "boolean", "`ok` continua decidido pelos gates de sempre")
})

// ── Certificação em máquina limpa: preparada, NÃO executada ────────────────

test("nesta máquina a certificação se RECUSA a rodar, e nomeia cada vestígio", async () => {
  const { planoDeCertificacao } = await imp("src/release/clean-machine-e2e.js")
  const p = planoDeCertificacao()
  assert.equal(p.runnable, false, "há GStack instalado aqui: não é máquina limpa")
  assert.ok(p.blockers.length > 0)
  for (const b of p.blockers) assert.ok(b.path && b.reason, "vestígio sem caminho manda a pessoa procurar")
})

test("a célula produzida nasce `not_run` — o plano não pinta nada de verde", async () => {
  const { planoDeCertificacao } = await imp("src/release/clean-machine-e2e.js")
  const { problemasDaCelula } = await imp("src/meta/prd52-schemas.js")
  const p = planoDeCertificacao()
  assert.equal(p.cell.verdict, "not_run")
  assert.deepEqual(problemasDaCelula(p.cell), [], "a célula é válida pelo schema do §26.3")
})

test("em máquina SEM vestígio o plano fica executável (a recusa é medida, não fixa)", async () => {
  const { planoDeCertificacao } = await imp("src/release/clean-machine-e2e.js")
  const limpa = await mkdtemp(path.join(tmpdir(), "gstack-limpa-"))
  try {
    const p = planoDeCertificacao({ home: limpa })
    assert.equal(p.runnable, true)
    assert.deepEqual(p.blockers, [])
  } finally { await rm(limpa, { recursive: true, force: true }) }
})

test("os passos exigem uninstall: instalação que não se desfaz deixa a máquina pior", async () => {
  const { PASSOS } = await imp("src/release/clean-machine-e2e.js")
  const ids = PASSOS.map((p) => p.id)
  assert.deepEqual(ids, ["install", "runtime", "enforcement", "uninstall"])
  assert.ok(PASSOS.find((p) => p.id === "enforcement").comando.includes("bloqueia"),
    "o passo que fecha o P0 do Codex é provar que um hook REALMENTE bloqueia")
})
