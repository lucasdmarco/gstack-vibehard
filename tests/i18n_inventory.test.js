import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD48 P2.1 — Fase 1: inventário determinístico da superfície de mensagem.
 *
 * O que este arquivo protege é a HONESTIDADE do inventário, não o número:
 *
 *  - escopo de `scripts/` é DERIVADO de import/spawn reais — comentário e string de
 *    evidência não promovem nada a runtime (a 1ª versão contava menção textual e
 *    "descobriu" 9 scripts runtime, um deles citado só dentro de um comentário);
 *  - classificação é por CANAL, nunca por default — a 1ª versão marcava 1.850 pontos
 *    como `public_diagnostic` por omissão, o que daria inventário "completo" com zero
 *    análise;
 *  - `unknown` é estado de primeira classe e BLOQUEIA a migração.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`)

test("escopo de scripts é DERIVADO: menção em comentário/string NÃO promove a runtime", async () => {
  const { runtimeScriptOrigins } = await imp()
  const o = runtimeScriptOrigins(repoRoot)
  // `capability-bands.mjs` é citado num COMENTÁRIO de src/meta/capability-bands.js.
  // A 1ª versão deste extrator o promovia a runtime por isso — grep disfarçado de grafo.
  assert.ok(!o["capability-bands.mjs"], "menção em comentário não é execução")
  assert.ok(!o["vertical-saas-auth-stripe.mjs"], "path de evidência em checklist não é execução")
})

// CONTRAPROVA exigida na revisão humana: ausência de import/spawn em `src/` NÃO prova
// que o script não roda — prova só que não roda por ali. O ciclo de vida do npm executa
// scripts durante pack/version/install, e foi assim que a 1ª conclusão ("nenhum script é
// runtime") se revelou incompleta.
test("o grafo de raízes inclui ciclo de vida do npm, não só src/ e bin", async () => {
  const { runtimeScriptOrigins } = await imp()
  const o = runtimeScriptOrigins(repoRoot)
  assert.deepEqual(o["clean-pkg.mjs"], ["lifecycle:prepack"], "roda ao empacotar")
  assert.deepEqual(o["sync-qg-version.mjs"], ["lifecycle:version"], "roda ao versionar")
})

/**
 * FASE 1 ENCERRADA — e o estado declarado continua impedindo a leitura errada,
 * agora do outro lado. Durante todo o programa este teste dizia "extractor
 * mergeado NAO e inventario pronto"; hoje o inventario ESTA pronto, e a coisa que
 * ele impede de ler errado e outra: `Fase 1 completa` NAO autoriza a claim
 * English-first. Isso e do cutover, e `englishFirstClaimAllowed` segue `false`.
 */
test("Fase 1 encerrada NAO autoriza a claim — o cutover e outra decisao", async () => {
  const { buildInventory, phaseStatus } = await imp()
  const s = phaseStatus(buildInventory({ repoRoot }))
  assert.equal(s.phaseStatus, "complete")
  assert.equal(s.phase, "1")
  assert.equal(s.nextPhase, "2")
  assert.equal(s.unknown, 0)
  assert.equal(s.englishFirstClaimAllowed, false,
    "encerrar a Fase 1 libera a MIGRACAO, nunca a claim publica")
  assert.equal(s.rcBlocked, true, "e o RC segue bloqueado ate o cutover acontecer")
})

test("CONTROLE POSITIVO: com unknown zerado, a Fase 1 encerra e libera a migração", async () => {
  const { phaseStatus } = await imp()
  const s = phaseStatus({ unknown: 0 })
  assert.equal(s.phaseStatus, "complete")
  assert.equal(s.nextPhase, "2")
  assert.equal(s.englishFirstClaimAllowed, false, "encerrar a Fase 1 ainda NÃO autoriza a claim — isso é do cutover")
})

test("scripts de mantenedor/CI são listados como FORA da claim, por derivação", async () => {
  const { maintainerOnlyScripts } = await imp()
  const m = maintainerOnlyScripts(repoRoot)
  assert.ok(m.includes("test-pack.mjs"), "ferramenta de teste fica fora")
  assert.ok(m.includes("command-lint.mjs"), "ferramenta de mantenedor fica fora")
  assert.ok(m.length > 5)
})

test("classificação é por CANAL: só o render sancionado é público por construção", async () => {
  const { classifyJsPoint } = await imp()
  assert.equal(classifyJsPoint({ sink: "cli_render" }).audience, "public_diagnostic")
  assert.equal(classifyJsPoint({ sink: "console" }).audience, "unknown", "escrita crua não se auto-declara")
  assert.equal(classifyJsPoint({ sink: "stdout" }).audience, "unknown")
  assert.equal(classifyJsPoint({ sink: "stdout", emitsJson: true }).audience, "machine_protocol")
})

test("hook Python: classificação por canal/condição, jamais pelo conteúdo da frase", async () => {
  const { classifyHookPoint } = await imp()
  assert.equal(classifyHookPoint({ sink: "json" }).audience, "machine_protocol")
  assert.equal(classifyHookPoint({ sink: "stdout" }).audience, "machine_protocol", "stdout de hook é protocolo")
  assert.equal(classifyHookPoint({ sink: "stderr", insideExceptHandler: true }).audience, "public_diagnostic")
  assert.equal(classifyHookPoint({ sink: "stderr", guardedByDebug: true }).audience, "internal_debug")
})

test("CONTROLE: stderr sem condição determinável fica `unknown`, NUNCA vira interno", async () => {
  const { classifyHookPoint } = await imp()
  const r = classifyHookPoint({ sink: "stderr" })
  assert.equal(r.audience, "unknown", "assumir 'interno' é como uma mensagem PT-BR sobrevive à migração")
})

test("o gate da Fase 1 BLOQUEIA enquanto houver unknown", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const inv = buildInventory({ repoRoot })
  const g = phase1Gate(inv)
  assert.equal(g.ok, inv.unknown === 0)
  if (inv.unknown > 0) assert.match(g.reason, /classificar antes de migrar/)
})

test("CONTROLE POSITIVO: inventário sem unknown libera o gate (o caminho existe)", async () => {
  const { phase1Gate } = await imp()
  // Contrato COMPLETO, não subconjunto: a Fatia 3 acrescentou `blocked` e
  // `registryStatus`, e o gate agora reprova por registry inválido ANTES de
  // olhar contagem. Afrouxar para `assert.partialDeepStrictEqual` deixaria o
  // caminho bloqueado passar despercebido aqui.
  assert.deepEqual(phase1Gate({ unknown: 0, jsRegistry: { ok: true, status: "fresh" } }), {
    ok: true, blocked: false, registryStatus: "fresh", unknown: 0,
    provenanceOk: true, unresolvedProvenance: 0, reason: null,
  })
})

test("CONTROLE NEGATIVO: gate BLOQUEIA por registry inválido, sem olhar contagem", async () => {
  const { phase1Gate } = await imp()
  const g = phase1Gate({
    blocked: true,
    jsRegistry: { ok: false, status: "stale", reason: "hash divergente", details: { files: [] } },
    unknown: 0,
  })
  assert.equal(g.ok, false, "`unknown: 0` não pode aprovar inventário não medido")
  assert.equal(g.blocked, true)
  assert.equal(g.registryStatus, "stale")
  assert.equal(g.unknown, null, "`null` distingue NÃO MEDIDO de ZERO")
})

test("todo ponto carrega file/line/sink/audience/owner/classification (registro auditável)", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  for (const p of inv.points.slice(0, 40)) {
    for (const campo of ["file", "line", "sink", "audience", "owner", "classification"]) {
      assert.ok(p[campo] !== undefined, `ponto declara ${campo}`)
    }
  }
})

test("templates NÃO são excluídos em bloco — owner `generated`, classificados individualmente", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  const t = inv.points.filter((p) => p.file.startsWith("templates/"))
  assert.ok(t.length > 0, "templates entram no inventário")
  assert.ok(t.every((p) => p.owner === "generated"), "owner distingue artefato gerado do GStack")
})

test("registry só REFINA unknown — nunca reclassifica audiência derivada", async () => {
  const { buildInventory } = await imp()
  const semRegistry = buildInventory({ repoRoot })
  const alvo = semRegistry.points.find((p) => p.audience === "machine_protocol")
  const comRegistry = buildInventory({ repoRoot, registry: { [alvo.file]: "public_diagnostic" } })
  const depois = comRegistry.points.find((p) => p.file === alvo.file && p.line === alvo.line && p.sink === alvo.sink)
  assert.equal(depois.audience, "machine_protocol", "declaração humana não pode virar contrato de máquina em texto público")
})

test("validateRegistry rejeita entrada morta e audiência inválida", async () => {
  const { validateRegistry } = await imp()
  const bom = validateRegistry({ "src/cli/index.js": "public_diagnostic" }, repoRoot)
  assert.equal(bom.ok, true)
  const ruim = validateRegistry({ "src/nao/existe.js": "public_diagnostic" }, repoRoot)
  assert.equal(ruim.ok, false)
  const invalida = validateRegistry({ "src/cli/index.js": "audiencia_inventada" }, repoRoot)
  assert.equal(invalida.ok, false)
})

test("validateRegistry recusa script que NÃO é alcançado pelo runtime (não pertence à claim)", async () => {
  const { validateRegistry } = await imp()
  const r = validateRegistry({ "scripts/test-pack.mjs": "public_diagnostic" }, repoRoot)
  assert.equal(r.ok, false)
  assert.match(r.problemas[0].erro, /não é alcançado pelo runtime/)
})

// -- CENSO GLOBAL CANONICO ---------------------------------------------------

/**
 * O UNICO lugar onde o numero global vive.
 *
 * Antes, seis arquivos de teste repetiam `unknown === 54` e a lista inteira de
 * convertidos. Cada arquivo do lote JS quebrava os seis, e a correcao mecanica
 * era reescrever o mesmo numero em seis lugares -- censo virando ruido. Os
 * outros arquivos passaram a afirmar RELACOES (todo unknown esta fora dos
 * convertidos, declarado === aplicado, total estavel) e apontam para ca.
 *
 * ATUALIZE AQUI, e so aqui, a cada arquivo reconciliado no lote JS.
 */
test("CENSO GLOBAL: 1906 pontos, 0 unknown, 25 arquivos convertidos", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })

  // TOTAL e invariante do lote: converter troca a FONTE do ponto (regex -> AST),
  // nunca a existencia dele. "Nenhum ponto perdido" e medido aqui.
  // O total cai quando o arquivo convertido tinha FALSO POSITIVO do regex — e
  // so nesse caso. `scripts/clean-pkg.mjs:28` e `console.error(...)`, e o
  // extrator regex contava DOIS pontos na mesma linha: `28:cli_render` (o
  // `error(` de dentro casa o padrao de helper) e `28:console`. Medido em
  // worktree limpo do commit anterior, antes de converter. O AST ve UMA chamada.
  //
  // 1906 -> 1905: um falso positivo a menos. Nenhum ponto REAL sumiu — e a
  // distincao entre as duas coisas e justamente o que esta asercao guarda.
  //
  // 1905 -> 1924: DESCOBERTA DE COBERTURA, e o unico salto para cima ate aqui.
  // A fronteira do inventario Python deixou de ser o caminho literal `hooks/` e
  // passou a ser derivada (distribuido no pacote E alcancado por execucao real).
  // Entraram os 19 pontos de `src/context-docs/py/context_db.py`, que o
  // `context.js` dispara e cuja saida ele repassa crua — prosa escrita pelo
  // GStack que nao era contada em lugar nenhum. Subir aqui NAO e regressao: e o
  // censo passando a medir o que sempre existiu. Ver
  // tests/i18n_python_boundary.test.js.
  //
  // 1916 -> 1907: LOTE TYPESCRIPT, a maior queda de falso positivo ate aqui. O
  // regex contava 26 pontos nos 8 arquivos do template onde o AST ve 17. Os 9
  // extras sao de dois tipos, ambos ja conhecidos: 4 duplas contagens de
  // `console.error` (o `error(` de dentro casa o padrao de helper) e 5
  // `success(res, …)`, que e helper de RESPOSTA HTTP e nao de render --
  // `health.ts` e `users.ts` ficam com ZERO ponto, e por isso entram na lista de
  // convertidos: fora dela, o regex seguiria imputando pontos que nao existem.
  //
  // 1907 -> 1905: REMOCAO de `before_shell.py`, hook distribuido que nenhum
  // harness registrava e cuja unica capacidade -- bloquear pipe-to-shell -- ja
  // existia viva em `pre_tool_use_security.py`. Caem 2 pontos de UMA emissao: o
  // scanner contava `:44` duas vezes (`print` e `json`), a mesma dupla contagem
  // ja documentada em `context_db.py`. Aqui o total cai porque a SUPERFICIE
  // sumiu de verdade, e nao por falso positivo.
  //
  // 1905 -> 1906: a correcao do `P1.CLI-JSON-EXIT-CODE` acrescentou UM ponto de
  // mensagem -- o documento de erro de uso do `research`. Os demais nao se
  // moveram: as recusas passaram a emitir por THUNK justamente para que o
  // literal continuasse no callsite de um sink e nao sumisse do censo. A
  // primeira versao da correcao perdeu 8 pontos por passar a frase como
  // argumento, e foi o proprio inventario que cobrou.
  assert.equal(inv.total, 1906, "converter nao pode sumir com ponto REAL; falso positivo do regex pode cair")

  // Medicao em movimento: cai a cada arquivo reconciliado. 54 -> 53 com qa.js;
  // 53 -> 52 com secrets.js.
  //
  // POR QUE -1 E NAO -2, ja que o AST media DOIS unknown em secrets.js: antes da
  // conversao o arquivo era medido pelo extrator REGEX, que via 1 unknown nos
  // mesmos 28 pontos. O delta do censo e (unknown do regex) -> (unknown do AST),
  // nao (unknown do AST antes) -> 0. Trocar a fonte de medicao e o objetivo da
  // fase; esperar -2 seria comparar duas reguas diferentes.
  // 52 -> 51 com src/index.js, pela regra nova `cli-version-surface`.
  //
  // 51 -> 50 com orchestrate.js (lote JS 4/14). Aqui o delta e -1 e nao -2
  // embora o AST media DOIS unknown no arquivo, pelo mesmo motivo de secrets.js:
  // antes da conversao o arquivo era medido pelo extrator REGEX, que via 1
  // unknown. O delta do censo e sempre (unknown do regex) -> (unknown do AST).
  //
  // 50 -> 49 com init.js (lote JS 5/14), pela regra nova `console-blank-line`.
  //
  // 49 -> 48 com visual.js (lote JS 6/14). Aqui o delta e -1 embora o AST
  // medisse DOZE unknown no arquivo, pela mesma troca de regua de sempre: o
  // regex via 1. O arquivo so fechou com TRES coisas juntas — C-3 (tabela
  // congelada), C-4(b) (`console.log(renderFeedbackMarkdown(...))`) e a prova
  // publica de `visual --json` cobrindo dez dos onze pontos de maquina.
  //
  // 48 -> 45 com os dois scripts de lifecycle (C-5, lote JS 7 e 8/14): dois
  // unknown em `sync-qg-version.mjs` e um em `clean-pkg.mjs`.
  //
  // 45 -> 58 -> 45 na mesma leva. A fronteira Python derivada trouxe 19 pontos
  // do indexer; 13 deles passaram pela fila antes de `CLI_RULES` existir. Com as
  // regras da especie `cli_subprocess` no lugar, os 19 saem classificados e a
  // fila volta ao tamanho anterior. O saldo da leva e o que importa: +19 de
  // COBERTURA, 0 de divida.
  //
  // 45 -> 41 -> 45: `context.js` chegou a `unknown: 0` e a conversao foi
  // REVERTIDA no mesmo dia. Chegar a zero unknown e necessario, nao suficiente:
  // converter levou `unresolvedProvenance` de 0 para 28, e um daqueles 28
  // (`:201`, um trecho de documento do USUARIO) nao admite decisao honesta com
  // o vocabulario atual. Meia conversao valida some com a divida. Ver o
  // comentario em `scripts/i18n-registry.mjs` e
  // tests/i18n_context_conversion_blocked.test.js.
  //
  // 45 -> 44 com research.js (lote JS 9/14). Delta -1 e nao -5 pela troca de
  // regua de sempre: o regex media 1 unknown no arquivo, o AST media 5. Fechou
  // com a prova publica de `research --json` MAIS as 15 decisoes de provenance
  // -- e desta vez a segunda metade foi medida ANTES de declarar convertido.
  //
  // 44 -> 40 com a RECONVERSAO de context.js (lote JS 10/14). A primeira
  // tentativa foi revertida por levar `unresolvedProvenance` de 0 a 28; agora as
  // 28 decisoes existem -- 27 de moldura literal e uma de
  // `preserve_user_content_verbatim` para `:201`, o trecho de documento do
  // usuario. O delta e -4 e nao -5 pela troca de regua: o regex media 4 unknown
  // no arquivo, o AST media 5.
  //
  // 40 -> 36 com o plugin do OpenCode (lote JS 11/14). Delta -4, e o TOTAL cai 4
  // junto: o regex media 8 pontos onde o AST ve 4 -- os quatro extras sao falso
  // positivo do padrao de helper dentro de `console.warn(`. Nenhum ponto REAL
  // sumiu, e a distincao entre as duas coisas e o que esta asercao guarda.
  //
  // 36 -> 35 com task-run.js (lote JS 12/14). Delta -1 pela troca de regua: o
  // regex media 1 unknown, o AST media 2 -- e os DOIS fecharam com declaracao
  // FILE-SCOPED de consumidor, sem capacidade nova. Total inalterado: regex e
  // AST veem 12 pontos aqui, sem falso positivo a cair.
  //
  // 35 -> 30 com install.js (lote JS 13/14). Delta -5 e o TOTAL cai 4: o regex
  // media 197 pontos onde o AST ve 193 -- quatro falsos positivos do padrao de
  // helper. Fechou com a capacidade de helper por tabela (`:359`) mais a prova
  // publica de `install --audit-only --json` (`:475`), e 39 decisoes auditadas
  // por callsite.
  //
  // 30 -> 27 com runtime-supervisor.js (lote JS 14/14). FECHA O LOTE JS: os 27
  // restantes sao TODOS fora de JS -- 16 em templates TS e 11 em hooks Python.
  // O delta e -3 e nao -6 pela troca de regua: o regex media 3 unknown, o AST
  // media 6. Total inalterado (42 pontos nos dois extratores).
  //
  // 27 -> 11 com o lote TYPESCRIPT. Delta -16, e desta vez regex e AST veem o
  // MESMO numero de unknown: os 16 sao `console.*` que os dois extratores
  // enxergam. Fecharam por duas regras novas, e a divisao entre elas e a prova:
  // 16 por `generated-dev-console` e um so, `app.log.error(err)`, por
  // `generated-framework-logger`. Os 11 restantes sao TODOS Python dos hooks.
  //
  // 11 -> 5 com a fatia dos hooks. Delta -6, e o que NAO fechou e o achado:
  // `before_shell.py` e `gc.py` sao COPIADOS pelo instalador (`codex.js` copia
  // todo `.py` do diretorio) e NENHUM harness os registra em evento algum. Sem
  // consumidor, chamar o stdout deles de protocolo seria afirmar contrato que
  // ninguem fala, entao os 5 pontos ficam `unknown` e BLOQUEIAM a Fase 1B --
  // que e o efeito correto, e o oposto de entrarem calados na claim. Ver
  // tests/i18n_hook_rules.test.js, que guarda o achado como asercao.
  //
  // 5 -> 4 com a remocao do hook orfao; 4 -> 0 com o contrato executavel de
  // `quality_gate.gstack_check`, que da consumidor verificavel ao `gc.py`.
  //
  // FASE 1B FECHADA. Os dois ultimos hooks sairam por caminhos OPOSTOS, e a
  // assimetria era a decisao: um foi REMOVIDO (distribuido sem consumidor,
  // duplicando capacidade viva), o outro ganhou CONTRATO. Nenhum foi registrado
  // em evento para fazer numero.
  assert.equal(inv.unknown, 0, "nenhum ponto de saida sem audiencia, em nenhuma linguagem")
  assert.equal(inv.jsRegistry.convertedFiles.length, 25)
  assert.equal(inv.blocked, false)

  // A relacao que sustenta o numero: nenhum convertido guarda unknown.
  const convertidos = new Set(inv.jsRegistry.convertedFiles)
  assert.equal(inv.points.filter((p) => convertidos.has(p.file) && p.audience === "unknown").length, 0,
    "arquivo so e declarado convertido com unknown ZERO")
})
