import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD48 P2.1 — Fase 1B, fatia `hooks/hooks/stop.py`.
 *
 * As regras aqui classificam por EMISSOR, CANAL, CONDIÇÃO e CONSUMIDOR. Nenhuma olha o
 * texto da mensagem — texto é exatamente o sinal que não se pode usar, porque produz
 * falso positivo em path, nome próprio e dado do usuário.
 *
 * `unknown` nunca vira "interno" por default: se nenhuma regra casa, o ponto continua
 * `unknown` e bloqueia a fase.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`)

test("POSITIVO: ramo de guarda/bloqueio ⇒ public_security_decision", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "stderr", securityBranch: true })
  assert.equal(r.audience, "public_security_decision")
  assert.equal(r.rule, "security-branch")
})

test("POSITIVO: stderr com prefixo de canal no fluxo normal ⇒ public_diagnostic", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "stderr", channelPrefixed: true })
  assert.equal(r.audience, "public_diagnostic")
})

// CORREÇÃO da revisão humana: traceback impresso pelo PRÓPRIO GStack não é passthrough.
// A exposição é decisão dele, e traceback cru carrega risco de path/conteúdo/secret.
test("POSITIVO: traceback do próprio hook ⇒ public_diagnostic, com risco registrado", async () => {
  const { classifyHookPoint, hookRules } = await imp()
  const r = classifyHookPoint({ sink: "stderr", inCrashHandler: true })
  assert.equal(r.audience, "public_diagnostic")
  assert.equal(r.rule, "own-crash-traceback")
  const regra = hookRules().find((x) => x.id === "own-crash-traceback")
  assert.match(regra.risk, /secret/i, "o risco de exposição fica declarado na própria regra")
})

test("NEGATIVO: external_passthrough NÃO é alcançável sem subprocesso externo provado", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(inv.byAudience.external_passthrough || 0, 0,
    "nada foi provado como bytes de subprocesso externo — a categoria não pode ser atalho")
})

// CORREÇÃO: `machine_protocol` estava absorvendo coisas diferentes e viraria depósito
// de "casos sem idioma". Byte de terminal e marcador de teste ganharam classe própria.
test("POSITIVO: caractere de controle puro ⇒ terminal_control (não é protocolo)", async () => {
  const { classifyHookPoint } = await imp()
  assert.equal(classifyHookPoint({ sink: "stderr", payloadIsControlChar: true }).audience, "terminal_control")
})

test("POSITIVO: marcador sob env explícita ⇒ test_observability (não é protocolo público)", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "stderr", envGuarded: true, emitsStructuredToken: true })
  assert.equal(r.audience, "test_observability")
  assert.equal(r.rule, "test-observability-marker")
})

test("machine_protocol EXIGE consumidor real provado — senão vira depósito", async () => {
  const { buildInventory, machineProtocolAudit, MACHINE_PROTOCOL_CONSUMERS } = await imp()
  const audit = machineProtocolAudit(buildInventory({ repoRoot }))
  assert.equal(audit.ok, true, `sinks sem consumidor: ${JSON.stringify(audit.semConsumidor)}`)
  for (const c of MACHINE_PROTOCOL_CONSUMERS) {
    assert.ok(c.consumer && c.contract && c.evidence, `${c.sink} declara consumidor, contrato e evidência`)
  }
})

test("CONTROLE NEGATIVO: sink novo em machine_protocol sem consumidor registrado REPROVA", async () => {
  const { machineProtocolAudit } = await imp()
  const sintetico = { points: [{ file: "x.py", line: 1, sink: "socket", audience: "machine_protocol" }] }
  const audit = machineProtocolAudit(sintetico)
  assert.equal(audit.ok, false)
  assert.equal(audit.semConsumidor[0].sink, "socket")
})

/**
 * A conversão AST de `create.js` trouxe o 1º sink JS para cá. Sem ancoragem, declarar
 * `process.stdout.write` uma vez cobriria TODO `process.stdout.write` do repositório —
 * a declaração de um comando viraria alvará para os outros ~50 que virão no lote JS.
 */
test("CONTROLE NEGATIVO: entrada ANCORADA em arquivo não cobre o mesmo sink em OUTRO arquivo", async () => {
  const { machineProtocolAudit } = await imp()
  const ancorada = [{ file: "src/cli/create.js", sink: "process.stdout.write", consumer: "x", contract: "y", evidence: "z" }]
  const mesmoArquivo = { points: [{ file: "src/cli/create.js", line: 1624, sink: "process.stdout.write", audience: "machine_protocol" }] }
  const outroArquivo = { points: [{ file: "src/commands/task.js", line: 39, sink: "process.stdout.write", audience: "machine_protocol" }] }
  assert.equal(machineProtocolAudit(mesmoArquivo, ancorada).ok, true, "cobre o arquivo que declarou")
  assert.equal(machineProtocolAudit(outroArquivo, ancorada).ok, false, "e SÓ ele — senão a âncora é decorativa")
})

test("o sink JS de `create --dry-run --json` está declarado com âncora, e não por sink solto", async () => {
  const { MACHINE_PROTOCOL_CONSUMERS } = await imp()
  const e = MACHINE_PROTOCOL_CONSUMERS.find((c) => c.sink === "process.stdout.write")
  assert.ok(e, "o ponto convertido em create.js precisa de declaração própria")
  assert.equal(e.file, "src/cli/create.js", "declaração de sink JS sem âncora cobriria o repositório inteiro")
  assert.match(e.evidence, /json_purity_contract/, "a evidência é o contrato `--json` já provado por subprocess real")
})

test("NEGATIVO: stderr sem NENHUM sinal estrutural continua unknown", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "stderr" })
  assert.equal(r.audience, "unknown", "ausência de evidência não é evidência de que é interno")
  assert.equal(r.rule, null)
})

test("NEGATIVO: nenhuma regra pode produzir internal_debug sem ativação explícita", async () => {
  const { classifyHookPoint, hookRules } = await imp()
  assert.notEqual(classifyHookPoint({ sink: "stderr" }).audience, "internal_debug")
  const debugRules = hookRules().filter((r) => r.audience === "internal_debug")
  assert.equal(debugRules.length, 1, "só existe UMA porta para internal_debug")
  assert.match(debugRules[0].reason, /ativação explícita/)
})

test("NEGATIVO (regressão real): escrita FORA do ramo de guarda não vira decisão de segurança", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  const p = inv.points.find((x) => x.file.endsWith("stop.py") && x.line === 1227)
  // `stop.py:1227` ("commit criado") vem DEPOIS do subprocess.run, fora do `if allow_dirty`
  // 5 linhas acima. A 1ª versão usava janela de 6 linhas e a classificou como
  // public_security_decision. Janela de linhas não é escopo; em Python, escopo é indentação.
  assert.equal(p.audience, "public_diagnostic", "fluxo normal não pode virar decisão de segurança por proximidade textual")
})

test("toda regra declara audiência válida, trigger e razão auditável", async () => {
  const { hookRules, AUDIENCES } = await imp()
  for (const r of hookRules()) {
    assert.ok(AUDIENCES.includes(r.audience), `${r.id} usa audiência do vocabulário`)
    assert.ok(r.trigger, `${r.id} declara trigger`)
    assert.ok(r.reason && r.reason.length > 30, `${r.id} registra a razão estrutural`)
  }
})

test("FATIA FECHADA: stop.py tem ZERO unknown, e cada ponto carrega a regra que o classificou", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  const pontos = inv.points.filter((x) => x.file.endsWith("stop.py"))
  assert.ok(pontos.length >= 50, "a fatia é substancial")
  assert.equal(pontos.filter((x) => x.audience === "unknown").length, 0)
  for (const p of pontos) assert.ok(p.audience, `${p.file}:${p.line} classificado`)
})

test("a fatia NÃO fecha o inventário: o gate global segue bloqueando", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.ok(inv.unknown > 0, "outros arquivos ainda têm unknown")
  assert.equal(phase1Gate(inv).ok, false, "fechar uma fatia nunca encerra a Fase 1")
})
