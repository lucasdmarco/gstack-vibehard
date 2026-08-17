import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * HOOK DISTRIBUÍDO PRECISA DE CONSUMIDOR — o controle que `before_shell.py`
 * cobrou.
 *
 * O instalador copia TODO `.py` de `hooks/hooks/` (`codex.js`:
 * `readdirSync(HOOKS_SOURCE).filter(f => f.endsWith(".py"))`). Cópia em bloco é
 * conveniente e tem um custo: basta um arquivo entrar no diretório para passar a
 * ser distribuído, sem que ninguém decida que ele deve rodar.
 *
 * Foi o que aconteceu. `before_shell.py` era distribuído para todo usuário,
 * nunca registrado em evento algum, e sua única capacidade — bloquear
 * pipe-to-shell — já existia VIVA em `pre_tool_use_security.py`, que É
 * registrado em PreToolUse. Superfície de ataque distribuída sem comportamento
 * em troca: o mesmo caso do downloader remoto duplicado que saiu de `create.js`.
 *
 * O QUE ESTE ARQUIVO GUARDA não é a ausência daquele nome — é a REGRA. Guardar
 * só o removido deixaria o próximo órfão entrar em silêncio.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel) => readFileSync(path.join(repoRoot, rel), "utf-8")
const HOOKS = path.join(repoRoot, "hooks", "hooks")

/** Todo `.py` que o instalador copia — a mesma travessia que ele faz. */
const distribuidos = () => readdirSync(HOOKS).filter((f) => f.endsWith(".py")).sort()

const jsDe = (rel) => {
  const dir = path.join(repoRoot, rel)
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => `${rel}/${f}`)
    : []
}

/**
 * AS QUATRO FORMAS de ter consumidor. Cada uma é uma prova diferente, e nenhuma
 * é "está no diretório de hooks":
 *
 *   evento    — registrado numa tabela de harness (`claude.js`, `codex.js`);
 *   comando   — spawnado/lido por código JS do produto;
 *   irmão     — importado ou spawnado por outro hook Python (os módulos `_*.py`
 *               e o autosave, que `stop.py` executa, entram por aqui);
 *   contrato  — documento VERSIONADO que nomeia o EVENTO e o ARQUIVO juntos.
 *
 * A quarta é a mais frouxa e por isso é a mais estrita na forma: citar o nome do
 * arquivo não basta, o documento tem que dizer em QUE evento ele roda. Sem essa
 * exigência a regra perderia os dentes — `before_shell.py` tinha docstring
 * dizendo "security check before shell execution" e teria passado.
 */
const TABELAS_DE_HARNESS = ["src/harness/claude.js", "src/harness/codex.js", "src/harness/opencode.js"]
const CONTRATOS_VERSIONADOS = ["skills/skills/mcp-setup/SKILL.md"]
const EVENTOS = ["SessionStart", "PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit", "PermissionRequest"]

const DIRS_DE_COMANDO = ["src/commands", "src/project-plan", "src/installer", "src/runtime", "src/harness"]
const citaEm = (rel, hook) => existsSync(path.join(repoRoot, rel)) && ler(rel).includes(hook)

const porEvento = (hook) => TABELAS_DE_HARNESS.filter((rel) => citaEm(rel, hook)).map((rel) => `evento:${rel}`)

const porComando = (hook) => DIRS_DE_COMANDO.flatMap(jsDe).filter((f) => ler(f).includes(hook))
  .map((f) => `comando:${f}`)

/** O irmão IMPORTA o módulo (`from _paths import …`) ou EXECUTA o arquivo. */
const irmaoUsa = (src, hook) =>
  new RegExp(`\\b(?:import|from)\\s+${hook.replace(/\.py$/, "")}\\b`).test(src) || src.includes(hook)

const porIrmao = (hook) => distribuidos().filter((irmao) => irmao !== hook)
  .filter((irmao) => irmaoUsa(readFileSync(path.join(HOOKS, irmao), "utf-8"), hook))
  .map((irmao) => `irmao:${irmao}`)

const porContrato = (hook) => CONTRATOS_VERSIONADOS
  .filter((rel) => existsSync(path.join(repoRoot, rel)))
  .filter((rel) => ler(rel).split(/\r?\n/).some((l) => declaraEvento(l, hook)))
  .map((rel) => `contrato:${rel}`)

const consumidoresDe = (hook) =>
  [...porEvento(hook), ...porComando(hook), ...porIrmao(hook), ...porContrato(hook)]

/** A linha declara o ARQUIVO **e** o EVENTO em que ele roda? */
const declaraEvento = (linha, hook) => linha.includes(hook) && EVENTOS.some((e) => linha.includes(e))

// ── A regra ────────────────────────────────────────────────────────────────

const orfaosEntre = (hooks) => hooks.filter((h) => consumidoresDe(h).length === 0).sort()

/**
 * A asserção é POSITIVA E NEGATIVA na mesma varredura, e isso é o que a torna
 * difícil de afrouxar: misturar um órfão conhecido aos hooks reais faz qualquer
 * critério mais permissivo MUDAR o resultado, em vez de esconder o problema. O
 * mutation control cobrou exatamente isso — asserção só de vacuidade (`lista
 * vazia`) sobrevivia a trocar o filtro por `[]`.
 */
test("a regra separa hook consumido de órfão, na MESMA varredura", () => {
  const hooks = distribuidos()
  assert.ok(hooks.length >= 10, `a varredura precisa ver os hooks reais, veio ${hooks.length}`)

  assert.deepEqual(orfaosEntre([...hooks, "before_shell.py"]), ["before_shell.py"],
    "a regra precisa achar o órfão conhecido no meio dos hooks legítimos")
  assert.deepEqual(orfaosEntre(hooks), [],
    "hook distribuído sem consumidor é superfície entregue ao usuário que ninguém decidiu executar")
})

/**
 * A REGRA PRECISA TER DENTES, e a prova disso é o próprio caso que a originou:
 * `before_shell.py` falha nas QUATRO formas. Sem esta asserção, afrouxar
 * `consumidoresDe` até tudo passar seria indistinguível de consertar.
 */
test("CONTROLE NEGATIVO: o arquivo removido falharia nas quatro formas", () => {
  assert.deepEqual(consumidoresDe("before_shell.py"), [],
    "se alguma forma o aceitasse, a regra estaria larga demais para ter pego o órfão real")
})

test("CONTROLE NEGATIVO: nome inventado não encontra consumidor", () => {
  assert.deepEqual(consumidoresDe("hook_que_nunca_existiu.py"), [])
})

/**
 * A PORTA DA FORMA MAIS FROUXA, testada direto porque o repositório não a
 * exercita: nenhum documento cita um hook sem também nomear o evento, então o
 * mutation control mostrou que remover a exigência de evento não quebrava nada.
 *
 * Citar o nome do arquivo é fácil e acontece o tempo todo — CHANGELOG, comentário,
 * nota de migração. O que promove um documento a CONTRATO é dizer em QUE evento
 * aquele arquivo roda; sem isso, uma menção de rodapé manteria um órfão vivo.
 */
test("PORTA: contrato precisa nomear o EVENTO, não só o arquivo", () => {
  assert.equal(declaraEvento("| PermissionRequest | ^Bash$ | permission_request.py | …", "permission_request.py"), true)
  assert.equal(declaraEvento("- corrigido bug em permission_request.py", "permission_request.py"), false,
    "menção de CHANGELOG não é contrato")
  assert.equal(declaraEvento('"""before_shell.py — security check before shell execution."""', "before_shell.py"), false,
    "docstring descrevendo a intenção não declara evento — e era tudo que o órfão tinha")
  assert.equal(declaraEvento("| Stop | any | stop.py | …", "outro.py"), false,
    "a linha precisa ser sobre AQUELE arquivo")
})

/**
 * AS FORMAS SÃO OBSERVÁVEIS UMA A UMA, e não só no agregado. Todo hook real
 * satisfaz mais de uma — `stop.py` está na tabela do harness E é citado por
 * código JS —, então o agregado sozinho não prova que cada porta funciona:
 * apagar a tabela de harness não quebrava nada, porque a outra forma cobria.
 */
test("PORTA: registro em tabela de harness é prova por si só", () => {
  assert.ok(consumidoresDe("stop.py").some((p) => p.startsWith("evento:")),
    "`stop.py` é registrado em Stop — se a tabela deixar de contar, a forma sumiu")
  assert.ok(consumidoresDe("session_start.py").some((p) => p.startsWith("evento:")))
})

test("PORTA: hook irmão que importa o módulo é prova por si só", () => {
  // `_paths.py` não é entrypoint e nunca será registrado em evento nenhum:
  // existe porque sete hooks fazem `from _paths import …`. Se a forma `irmao`
  // deixar de contar, ele e os outros quatro módulos `_*.py` viram órfãos.
  const provas = consumidoresDe("_paths.py")
  assert.deepEqual([...new Set(provas.map((p) => p.split(":")[0]))], ["irmao"],
    "a única prova de um módulo compartilhado é quem o importa")
  assert.equal(provas.length, 7)

  // E o autosave, que `stop.py` executa por caminho — mesma forma, outro modo.
  assert.deepEqual(consumidoresDe("git_worktree_autosave.py"), ["irmao:stop.py"])
})

/**
 * `permission_request.py` é o único que depende da forma mais frouxa, e fica
 * NOMEADO aqui em vez de se diluir no conjunto: nenhum instalador o registra —
 * `claude.js` registra 5 eventos e `codex.js` 4, e PermissionRequest não está em
 * nenhum dos dois. O que o sustenta é `SKILL.md`, que declara o evento, mais a
 * lista de confiança do Codex.
 *
 * NÃO é dívida silenciosa: é wiring que o usuário aplica, documentado. Mas se a
 * documentação sumir, ele vira órfão — e é este teste que avisa.
 */
test("`permission_request.py` se sustenta em contrato documentado, não em registro", () => {
  const provas = consumidoresDe("permission_request.py")
  assert.ok(provas.some((p) => p.startsWith("contrato:")),
    "o contrato versionado é o que o mantém legítimo")
  assert.equal(provas.some((p) => p.startsWith("evento:")), false,
    "se algum instalador passar a registrá-lo, esta expectativa muda e o teste avisa")
  assert.match(ler("skills/skills/mcp-setup/SKILL.md"), /PermissionRequest \|.*permission_request\.py/,
    "o documento precisa nomear o EVENTO e o ARQUIVO juntos — citar o nome não basta")
})

/**
 * A PORTA DA CÓPIA EM BLOCO, dita na asserção: enquanto o instalador copiar o
 * diretório inteiro, a decisão de distribuir é do `readdirSync` e não de uma
 * pessoa — e é por isso que a regra acima precisa existir.
 */
test("o instalador copia o diretório INTEIRO — a distribuição não é curada", () => {
  assert.match(ler("src/harness/codex.js"), /readdirSync\(HOOKS_SOURCE\)\.filter\(\(f\) => f\.endsWith\("\.py"\)\)/,
    "se a cópia virar allowlist, a regra de órfãos pode ser reescrita — até lá, ela é a única curadoria")
})

// ── O caso que originou a regra ────────────────────────────────────────────

test("`before_shell.py` saiu, e a capacidade dele continua VIVA onde é registrada", () => {
  assert.equal(existsSync(path.join(HOOKS, "before_shell.py")), false,
    "o arquivo morto não pode voltar")

  // A remoção não abriu buraco de segurança: o bloqueio de pipe-to-shell mora no
  // hook que o harness realmente executa.
  assert.match(ler("hooks/hooks/pre_tool_use_security.py"), /\(sh\|bash\|zsh\)/,
    "o padrão de pipe-to-shell precisa continuar no hook REGISTRADO em PreToolUse")
  assert.match(ler("src/harness/claude.js"), /PreToolUse:.*pre_tool_use_security\.py/s,
    "e ele precisa continuar registrado — senão a capacidade foi perdida, não movida")
})

/**
 * O desinstalador nunca teve `before_shell.py` como contrato, e é por isso que a
 * remoção não deixa resíduo na máquina de ninguém: ele deriva a lista dos
 * arquivos DO PACOTE, em vez de manter uma cópia que envelheceria.
 */
test("o uninstall deriva os hooks do pacote — não há lista a atualizar", () => {
  const un = ler("src/installer/uninstall.js")
  assert.match(un, /packageFileNames\(join\("hooks", "hooks"\), "\.py"\)/,
    "derivar do pacote é o que faz a remoção se propagar sozinha")
  assert.equal(un.includes("before_shell"), false,
    "e o arquivo removido nunca esteve na lista de registros a limpar")
})
