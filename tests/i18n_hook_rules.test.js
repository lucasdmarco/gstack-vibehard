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
  const p = inv.points.find((x) => x.file.endsWith("stop.py") && x.line === 1245)
  // `stop.py:1245` ("Commit local criado") vem DEPOIS do subprocess.run, fora do `if allow_dirty`
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
  // 50 -> 48: duas escritas do `_crash_handler` passaram a sair por
  // `escrita_segura`, e os pontos MIGRARAM para `_harness.py`. Não houve perda
  // — o total do censo não se moveu, e é ele que guarda isso.
  assert.ok(pontos.length >= 45, "a fatia é substancial")
  assert.equal(pontos.filter((x) => x.audience === "unknown").length, 0)
  for (const p of pontos) assert.ok(p.audience, `${p.file}:${p.line} classificado`)
})

/**
 * Durante todo o programa este teste dizia que fechar UMA fatia nunca encerra a
 * Fase 1 — e estava certo em cada leva. Os hooks foram a ÚLTIMA, e agora a
 * afirmação inverte de lado: o gate global aprova.
 *
 * O que ele guarda não mudou: que o gate é GLOBAL, e não a soma de fatias
 * declaradas fechadas. Ele continua lendo o inventário inteiro.
 */
test("a fatia dos hooks era a ÚLTIMA: o gate global aprova", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(inv.unknown, 0, "nenhum arquivo, de nenhuma linguagem, segue sem audiência")
  assert.equal(phase1Gate(inv).ok, true)
})


// ── Fatia dos hooks restantes: stdout serializado e relatório em stderr ─────

/**
 * O extrator dá sinks DIFERENTES a duas escritas no MESMO canal:
 * `sys.stdout.write(...)` vira `stdout` e `print(...)` vira `print`. A regra
 * `stdout-hook-protocol` só cobria o primeiro, e um hook escreve seu documento
 * de decisão com `print` quase sempre — a lacuna deixava aberto justamente o
 * caminho normal.
 *
 * A correção NÃO é dizer que `print` em hook é protocolo. Isso seria classificar
 * pelo diretório, que é o que a auditoria destes pontos proibia. São TRÊS
 * portas: o canal, o payload ser serialização sem ramo humano, e existir
 * CONSUMIDOR DECLARADO — a terceira nasceu de um achado desta fatia.
 */
test("POSITIVO: `print(json.dumps(...))` com consumidor declarado ⇒ machine_protocol", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "print", payloadIsSerialized: true, consumerDeclared: true })
  assert.equal(r.audience, "machine_protocol")
  assert.equal(r.rule, "hook-stdout-serialized")
})

test("NEGATIVO: `print` sem payload serializado NÃO vira protocolo por ser hook", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "print", consumerDeclared: true })
  assert.equal(r.audience, "unknown",
    "`print` em hook também é relatório humano — o canal não decide sozinho")
  assert.equal(r.rule, null)
})

/**
 * A PORTA DO CONSUMIDOR, e o achado que a criou: `before_shell.py` e `gc.py` são
 * COPIADOS pelo instalador e NENHUM harness os registra em evento algum. Sem
 * alguém do outro lado, chamar aquilo de protocolo seria afirmar um contrato que
 * ninguém fala.
 */
test("NEGATIVO: sem consumidor declarado, stdout serializado NÃO é protocolo", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "print", payloadIsSerialized: true })
  assert.equal(r.audience, "unknown")
  assert.equal(r.rule, null)
})

test("PRECEDÊNCIA: ativação de depuração continua ganhando de serialização", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({
    sink: "print", payloadIsSerialized: true, consumerDeclared: true, guardedByDebug: true,
  })
  assert.equal(r.audience, "internal_debug",
    "serializar não traz a chamada de volta ao fluxo padrão")
})

// ── Payload atrás de variável ──────────────────────────────────────────────

/**
 * `print(output)` e `sys.stderr.write(roi_summary)` — duas escritas reais dos
 * hooks montam o payload numa linha e o emitem noutra. O extrator, que só olha a
 * chamada, não via NADA nelas: ficavam `unknown` por limitação da medida, e não
 * por dúvida honesta.
 */
test("REPO: `print(output)` resolve até a serialização e fecha como protocolo", async () => {
  const { buildInventory } = await imp()
  const p = buildInventory({ repoRoot }).points
    .find((x) => x.file.endsWith("post_sprint.py") && x.line === 367)
  assert.equal(p.audience, "machine_protocol")
  assert.equal(p.rule, "hook-stdout-serialized",
    "as DUAS atribuições de `output` no corpo (linhas 356 e 361) são serialização")
})

test("REPO: `sys.stderr.write(roi_summary)` resolve até a frase e entra na claim", async () => {
  const { buildInventory } = await imp()
  const p = buildInventory({ repoRoot }).points
    .find((x) => x.file.endsWith("post_sprint.py") && x.line === 378)
  assert.equal(p.audience, "public_diagnostic")
  assert.equal(p.rule, "stderr-normal-flow-report")
})

/**
 * A porta da FORMA. Sem fato de payload não há decisão, e o ponto continua
 * `unknown` — jamais "interno" por default, que é a regra mais antiga desta fase.
 */
test("NEGATIVO: sem forma de payload conhecida, nada decide", async () => {
  const { classifyHookPoint } = await imp()
  assert.equal(classifyHookPoint({ sink: "print", consumerDeclared: true }).rule, null)
  assert.equal(classifyHookPoint({ sink: "stderr" }).rule, null)
})

// ── Relatório em stderr no fluxo normal ────────────────────────────────────

test("POSITIVO: frase em stderr, fora de toda guarda, é superfície de leitura", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "stderr", payloadIsStringLiteral: true })
  assert.equal(r.audience, "public_diagnostic")
  assert.equal(r.rule, "stderr-normal-flow-report")
})

/**
 * A REGRA É A ÚLTIMA DA LISTA, e a posição faz parte dela: só decide o que
 * sobrou. Cada guarda acima responde OUTRA coisa sobre a mesma linha, e vê-las
 * ganharem é o que impede esta de virar "stderr é público por default".
 */
for (const [guarda, ctx, esperado] of [
  ["depuração", { guardedByDebug: true }, "internal_debug"],
  ["ramo de bloqueio", { securityBranch: true }, "public_security_decision"],
  ["handler de crash", { inCrashHandler: true }, "public_diagnostic"],
  ["byte de controle", { payloadIsControlChar: true }, "terminal_control"],
  ["env de teste", { envGuarded: true, emitsStructuredToken: true }, "test_observability"],
]) {
  test(`PRECEDÊNCIA: ${guarda} decide antes do relatório de fluxo normal`, async () => {
    const { classifyHookPoint } = await imp()
    const r = classifyHookPoint({ sink: "stderr", payloadIsStringLiteral: true, ...ctx })
    assert.equal(r.audience, esperado)
    assert.notEqual(r.rule, "stderr-normal-flow-report")
  })
}

// ── Ancorado no repositório real ───────────────────────────────────────────

test("REPO: os 8 documentos com consumidor provado fecham por esta regra", async () => {
  const { buildInventory } = await imp()
  const porRegra = buildInventory({ repoRoot }).points
    .filter((p) => p.rule === "hook-stdout-serialized")
  assert.deepEqual(porRegra.map((p) => `${p.file}:${p.line}`).sort(), [
    // Os quatro de `gc.py` entraram por ÚLTIMO, e por um consumidor que não é
    // evento de harness: o contrato `quality_gate.gstack_check`, provado
    // executando o hook a partir da config que o `init` gera.
    "hooks/hooks/gc.py:183",
    "hooks/hooks/gc.py:189",
    "hooks/hooks/gc.py:195",
    "hooks/hooks/gc.py:272",
    "hooks/hooks/post_sprint.py:327",
    "hooks/hooks/post_sprint.py:367",
    "hooks/hooks/post_tool_use_review.py:111",
    "hooks/hooks/qg.py:87",
  ])
})

/**
 * O ACHADO, guardado como asserção para não virar nota de rodapé: dois hooks são
 * distribuídos e nunca registrados. Enquanto for assim, os pontos deles ficam
 * `unknown` e BLOQUEIAM a Fase 1B — que é o efeito correto, e o oposto de
 * entrarem calados na claim.
 *
 * Se alguém registrar qualquer um dos dois, ou removê-lo, este teste é quem
 * avisa que a decisão pendente foi tomada.
 */
test("REPO: `gc.py` é distribuído e NUNCA registrado em evento", async () => {
  const { readFileSync } = await import("node:fs")
  const claude = readFileSync(path.join(repoRoot, "src/harness/claude.js"), "utf-8")
  const codex = readFileSync(path.join(repoRoot, "src/harness/codex.js"), "utf-8")
  for (const orfao of ["gc.py"]) {
    assert.equal(claude.includes(orfao), false, `${orfao} apareceu no registro do Claude Code`)
    assert.equal(codex.includes(orfao), false, `${orfao} apareceu no registro do Codex`)
  }
  // Copiados assim mesmo: `codex.js` copia TODO `.py` do diretório de hooks.
  assert.match(codex, /readdirSync\(HOOKS_SOURCE\)/,
    "é a cópia em bloco que os distribui sem registrá-los")
})

/**
 * FIM DA FILA. Os dois hooks que sobraram fecharam por caminhos OPOSTOS, e a
 * assimetria era a decisão: `before_shell.py` foi REMOVIDO — distribuído sem
 * consumidor e duplicando capacidade viva —, e `gc.py` ganhou CONTRATO
 * executável, porque o consumidor dele existia e só não tinha forma verificável.
 *
 * Nenhum dos dois foi registrado em evento para fazer número.
 */
test("REPO: nenhum ponto Python segue `unknown`", async () => {
  const { buildInventory } = await imp()
  const abertos = buildInventory({ repoRoot }).points.filter((p) => p.audience === "unknown")
  assert.deepEqual(abertos.map((p) => `${p.file}:${p.line}`), [])
})

/**
 * DÍVIDA DA FASE 2, declarada e não disfarçada: o documento é contrato de
 * máquina, mas frases em PT-BR viajam DENTRO dele como valores — e a linha de
 * stderr que acabou de entrar na claim está em português. Classificar o ponto é
 * sobre o CANAL, e nunca uma alegação de que o conteúdo já está em inglês.
 */
test("REPO: as frases PT-BR seguem em aberto — dívida da Fase 2", async () => {
  const { readFileSync } = await import("node:fs")
  const gc = readFileSync(path.join(repoRoot, "hooks/hooks/gc.py"), "utf-8").split(/\r?\n/)
  assert.match(gc[181], /Uso: python gc\.py/, "linha 182 monta o valor que a 183 serializa")
  const ps = readFileSync(path.join(repoRoot, "hooks/hooks/post_sprint.py"), "utf-8").split(/\r?\n/)
  assert.match(ps[372], /Tokens salvos/, "linha 373 compõe o relatório que a 378 escreve")
})

// ── As portas da resolução de variável, em fixture ─────────────────────────

/**
 * O repositório real exercita só o caminho feliz: as duas variáveis que existem
 * são unânimes, montadas na mesma função e detectáveis na primeira linha. O
 * mutation control cobrou o resto — sem estas fixtures, trocar `every` por
 * `some`, não juntar a continuação multilinha ou varrer o arquivo inteiro em vez
 * do corpo da função não quebrava teste algum.
 */
const ctxDe = async (linhas, alvo) => {
  const { pythonContext } = await imp()
  return pythonContext(linhas.join("\n"), alvo)
}

test("PORTA: uma atribuição divergente derruba a serialização inteira", async () => {
  const c = await ctxDe([
    "def main():",
    "    if erro:",
    "        out = json.dumps(a)",
    "    else:",
    '        out = "falhou de vez"',
    "    print(out)",
  ], 6)
  assert.equal(c.payloadIsSerialized, false,
    "a linha emite documento OU frase conforme o caminho — indefinido é a resposta honesta")
  assert.equal(c.payloadIsStringLiteral, false, "e também não é frase, pelo mesmo motivo")
})

test("PORTA: uma atribuição divergente derruba a frase inteira", async () => {
  const c = await ctxDe([
    "def main():",
    '    msg = "relatorio"',
    "    if x:",
    "        msg = compute(y)",
    "    sys.stderr.write(msg)",
  ], 5)
  assert.equal(c.payloadIsStringLiteral, false,
    "`compute(y)` pode devolver qualquer coisa — a unanimidade é o que dá a resposta")
})

/**
 * A CONTINUAÇÃO É PORTA. `out = (` não diz nada sozinha: o valor vem nas linhas
 * indentadas abaixo. Sem juntá-las, uma serialização multilinha passaria por
 * frase — que é o erro mais caro possível aqui, porque tiraria um documento de
 * máquina para dentro da claim.
 */
test("PORTA: atribuição multilinha é lida inteira, não só a primeira linha", async () => {
  const serial = await ctxDe([
    "def main():",
    "    out = (",
    "        json.dumps(payload)",
    "    )",
    "    print(out)",
  ], 5)
  assert.equal(serial.payloadIsSerialized, true)
  assert.equal(serial.payloadIsStringLiteral, false,
    "`out = (` sozinha parece frase; a continuação é quem revela o documento")

  const frase = await ctxDe([
    "def main():",
    "    out = (",
    '        f"linha um"',
    '        f"linha dois"',
    "    )",
    "    sys.stderr.write(out)",
  ], 6)
  assert.equal(frase.payloadIsStringLiteral, true)
  assert.equal(frase.payloadIsSerialized, false)
})

/**
 * O ESCOPO É A FUNÇÃO, e não o arquivo. Um nome homônimo noutra função é outro
 * valor — varrer o arquivo inteiro faria a atribuição de um vizinho decidir esta
 * linha, que é a mesma classe de erro que a janela de 6 linhas cometeu na 1ª
 * versão de `enclosingConditions`.
 */
test("PORTA: homônimo em OUTRA função não decide esta linha", async () => {
  const c = await ctxDe([
    "def outra():",
    "    out = json.dumps(a)",
    "",
    "def main():",
    '    out = "relatorio humano"',
    "    print(out)",
  ], 6)
  assert.equal(c.payloadIsSerialized, false,
    "a serialização mora na função vizinha e não alcança esta chamada")
  assert.equal(c.payloadIsStringLiteral, true)
})

test("PORTA: sem atribuição alguma no corpo, o payload fica indefinido", async () => {
  const c = await ctxDe([
    "def main(out):",
    "    print(out)",
  ], 2)
  assert.equal(c.payloadIsSerialized, false, "parâmetro: quem chama decide, e isso não está aqui")
  assert.equal(c.payloadIsStringLiteral, false)
})

/**
 * A forma INDIRETA não pode alargar a forma DIRETA: `print(json.dumps(x) if f
 * else "frase")` continua recusado, e agora com o resolvedor de variável ligado.
 */
test("PORTA: o ramo condicional na própria chamada segue recusado", async () => {
  const c = await ctxDe([
    "def main():",
    '    print(json.dumps(out) if args.json else "Indexados 3 documentos")',
  ], 2)
  assert.equal(c.payloadIsSerialized, false)
})
