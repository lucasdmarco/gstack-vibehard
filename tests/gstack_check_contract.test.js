import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, copyFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * `gc.py` É CONSUMIDO — e a prova executa o consumo, não o descreve.
 *
 * Nenhum harness registra `gc.py` em evento, e conectá-lo a
 * PreToolUse/PostToolUse/Stop só para zerar o inventário seria inventar
 * comportamento. O consumidor real já existia e não tinha forma verificável: a
 * chave `quality_gate.gstack_check` que o produto ESCREVE em
 * `.gstack/config.json` de todo projeto que cria.
 *
 * A DISCIPLINA DESTE ARQUIVO: o caminho vem da CONFIGURAÇÃO GERADA pelo produto,
 * nunca escrito à mão aqui. Chamar `hooks/hooks/gc.py` direto seria conveniente e
 * provaria a coisa errada — provaria que o script roda, não que o contrato o
 * alcança.
 *
 * ISOLAMENTO: `HOME` é sempre um diretório descartável desta prova. Nada lê
 * `~/.gstack`, `~/.codex` ou qualquer configuração da máquina; a "instalação" é
 * feita aqui, copiando do pacote como o instalador faz.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "gstack-check-contract.js")).href}?t=${Date.now()}`)
const PY = process.platform === "win32" ? "python" : "python3"

/** Sandbox: HOME próprio + projeto próprio. Nada da máquina entra. */
function sandbox(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "gstack-check-"))
  t.after(() => cleanupTmp(raiz))
  const home = path.join(raiz, "home")
  const obras = path.join(raiz, "obras")
  mkdirSync(path.join(home, ".gstack", "hooks"), { recursive: true })
  mkdirSync(obras, { recursive: true })
  return { raiz, home, obras }
}

/**
 * "Instala" os hooks como o instalador faz: copiando TODO `.py` do pacote
 * (`codex.js`: `readdirSync(HOOKS_SOURCE).filter(f => f.endsWith(".py"))`).
 *
 * Copiar só `gc.py` seria uma instalação que não existe: ele faz `from _paths
 * import …` e `from _chronicle import …`, e a primeira versão desta prova
 * quebrou por `ModuleNotFoundError` — defeito do sandbox, não do produto. Uma
 * prova precisa reproduzir a instalação REAL, não uma conveniente.
 */
function instalarHooks(home) {
  const origem = path.join(repoRoot, "hooks", "hooks")
  const destino = path.join(home, ".gstack", "hooks")
  for (const f of readdirSync(origem).filter((x) => x.endsWith(".py"))) {
    copyFileSync(path.join(origem, f), path.join(destino, f))
  }
  return path.join(destino, "gc.py")
}

/**
 * A CONFIGURAÇÃO REAL, gerada pelo produto. Rodar `init` de verdade é o que
 * garante que o teste não inventa a chave que ele mesmo verifica.
 */
const NOME_DO_PROJETO = "projeto-do-contrato"

function gerarConfigReal(raiz, home) {
  // `stdin` fechado: `init` faz uma pergunta sobre design system, e a prova não
  // pode depender de interação. `HOME` apontado para a sandbox por precaução —
  // nada aqui deve tocar a máquina.
  execFileSync(process.execPath, [path.join(repoRoot, "src", "index.js"), "init", NOME_DO_PROJETO], {
    cwd: raiz, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000,
    env: { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home },
  })
  const projeto = path.join(raiz, NOME_DO_PROJETO)
  const cfg = path.join(projeto, ".gstack", "config.json")
  assert.ok(existsSync(cfg), "`init` precisa escrever `.gstack/config.json`")
  return { projeto, config: JSON.parse(readFileSync(cfg, "utf-8")) }
}

// ── O contrato existe e aponta para produtores reais ───────────────────────

test("os produtores declarados escrevem MESMO a chave do contrato", async () => {
  const { PRODUTORES_DO_CONTRATO } = await imp()
  assert.ok(PRODUTORES_DO_CONTRATO.length >= 3)
  for (const p of PRODUTORES_DO_CONTRATO) {
    const src = readFileSync(path.join(repoRoot, p.file), "utf-8")
    assert.match(src, /gstack_check/, `${p.file} deixou de escrever a chave — o contrato perdeu uma origem`)
    assert.match(src, /gc\.py/, `${p.file} não aponta mais para o arquivo do contrato`)
    assert.ok(p.evidence && p.evidence.includes(":"), "evidência precisa citar arquivo e linha")
  }
})

// ── A prova de ponta a ponta ───────────────────────────────────────────────

/**
 * O CAMINHO INTEIRO, numa asserção só: config gerada pelo produto → chave lida →
 * caminho resolvido → processo real → JSON puro → schema → exit code.
 */
test("E2E: a config real resolve o consumidor, executa e devolve o contrato", async (t) => {
  const { resolverGstackCheck, validarSaidaGstackCheck, dentroDeRaizPermitida } = await imp()
  const s = sandbox(t)
  instalarHooks(s.home)

  const { projeto, config } = gerarConfigReal(s.obras, s.home)
  assert.equal(typeof config.quality_gate.gstack_check, "string",
    "é a chave publicada que este contrato formaliza")

  const r = resolverGstackCheck(config, { home: s.home, packageRoot: repoRoot })
  assert.equal(r.ok, true, `resolução falhou: ${r.reason}`)
  assert.equal(r.source, "gstack_check", "a chave primária é a que resolve quando o hook está instalado")
  assert.ok(dentroDeRaizPermitida(r.path, [s.home]), "o consumidor precisa estar sob a raiz instalada")

  const saida = execFileSync(PY, [r.path, "--path", projeto], {
    encoding: "utf-8", stdio: "pipe", timeout: 120000,
    env: { ...process.env, HOME: s.home, USERPROFILE: s.home },
  })
  const v = validarSaidaGstackCheck(saida, 0)
  assert.equal(v.ok, true, `saída fora do contrato: ${v.problemas.join("; ")}`)
  assert.equal(v.kind, "success")
})

/**
 * A SEGUNDA FORMA do contrato, e é ela que fecha três dos quatro pontos de
 * mensagem: o `gc.py` recusa argumento inválido com JSON de erro e exit != 0.
 * Um contrato de uma forma só deixaria o caminho de erro sem prova.
 */
test("E2E: a forma de ERRO também é contrato — JSON puro e exit != 0", async (t) => {
  const { resolverGstackCheck, validarSaidaGstackCheck } = await imp()
  const s = sandbox(t)
  instalarHooks(s.home)
  const { config } = gerarConfigReal(s.obras, s.home)
  const r = resolverGstackCheck(config, { home: s.home, packageRoot: repoRoot })

  let erro = null
  try {
    execFileSync(PY, [r.path], { encoding: "utf-8", stdio: "pipe", timeout: 60000 })
  } catch (e) { erro = e }
  assert.ok(erro, "sem `--path`, o hook precisa falhar")
  assert.notEqual(erro.status, 0)

  const v = validarSaidaGstackCheck(erro.stdout, erro.status)
  assert.equal(v.ok, true, `forma de erro fora do contrato: ${v.problemas.join("; ")}`)
  assert.equal(v.kind, "error")
  assert.equal(String(erro.stderr ?? ""), "", "o contrato é stdout — stderr sujo confundiria o consumidor")
})

// ── As portas que precisam REPROVAR ────────────────────────────────────────

test("REPROVA: consumidor não declarado", async () => {
  const { resolverGstackCheck } = await imp()
  assert.equal(resolverGstackCheck({ quality_gate: { script: "x" } }, { home: "/h" }).reason,
    "consumidor_nao_declarado")
  assert.equal(resolverGstackCheck({}, { home: "/h" }).reason, "sem_quality_gate")
})

/**
 * CONFIG HOSTIL. O contrato autoriza executar UM arquivo conhecido, e não "o que
 * estiver escrito ali" — senão um `.gstack/config.json` adulterado viraria vetor
 * de execução num comando que o usuário considera de leitura.
 */
test("REPROVA: caminho que não é o arquivo do contrato", async () => {
  const { resolverGstackCheck } = await imp()
  for (const hostil of ["/tmp/evil.py", "~/.gstack/hooks/qualquer.py", "C:/Windows/System32/x.py"]) {
    const r = resolverGstackCheck({ quality_gate: { gstack_check: hostil } }, { home: "/h" })
    assert.equal(r.ok, false, `${hostil} não pode resolver`)
    assert.equal(r.reason, "fora_do_pacote")
  }
})

test("REPROVA: arquivo ausente em toda a cadeia", async (t) => {
  const { resolverGstackCheck } = await imp()
  const s = sandbox(t)
  const r = resolverGstackCheck(
    { quality_gate: { gstack_check: "~/.gstack/hooks/gc.py" } },
    { home: s.home, packageRoot: path.join(s.raiz, "pacote-inexistente") })
  assert.equal(r.ok, false)
  assert.equal(r.reason, "arquivo_ausente")
})

test("REPROVA: stdout contaminado não é contrato", async () => {
  const { validarSaidaGstackCheck } = await imp()
  const bom = JSON.stringify({
    project: "p", mode: "m", stack: [], infra: {}, topology: [], edges: [],
    graphify: {}, context7: {}, chronicle: {}, diagnostic_text: "",
  })
  assert.equal(validarSaidaGstackCheck(bom, 0).ok, true, "controle positivo")

  for (const sujo of [`aviso\n${bom}`, `${bom}\nrodape`, `${bom}${bom}`, "", "não é json"]) {
    const v = validarSaidaGstackCheck(sujo, 0)
    assert.equal(v.ok, false, `stdout contaminado passou: ${JSON.stringify(sujo.slice(0, 30))}`)
  }
})

test("REPROVA: schema incompleto e exit code incoerente", async () => {
  const { validarSaidaGstackCheck, CAMPOS_DE_SUCESSO } = await imp()
  const completo = Object.fromEntries(CAMPOS_DE_SUCESSO.map((c) => [c, null]))

  for (const campo of CAMPOS_DE_SUCESSO) {
    const { [campo]: _fora, ...parcial } = completo
    const v = validarSaidaGstackCheck(JSON.stringify(parcial), 0)
    assert.equal(v.ok, false, `faltando \`${campo}\` deveria reprovar`)
    assert.match(v.problemas.join(" "), new RegExp(campo))
  }

  assert.equal(validarSaidaGstackCheck(JSON.stringify(completo), 1).ok, false,
    "sucesso com exit != 0 é incoerente")
  assert.equal(validarSaidaGstackCheck(JSON.stringify({ error: "x" }), 0).ok, false,
    "erro com exit 0 esconderia a falha de quem decide por código")
  assert.equal(validarSaidaGstackCheck(JSON.stringify({ error: "x" }), 1).ok, true,
    "controle positivo da forma de erro")
})

test("REPROVA: documento que não é objeto", async () => {
  const { validarSaidaGstackCheck } = await imp()
  for (const doc of ["[]", "42", '"texto"', "null"]) {
    assert.equal(validarSaidaGstackCheck(doc, 0).ok, false, `${doc} não é documento de contrato`)
  }
})

// ── Expansão de caminho: as três formas dos três produtores ────────────────

test("a expansão cobre as formas que os produtores REALMENTE escrevem", async () => {
  const { expandirHome } = await imp()
  const home = path.join("C:", "h")
  assert.equal(expandirHome("~/.gstack/hooks/gc.py", home), path.join(home, ".gstack/hooks/gc.py"))
  assert.equal(expandirHome("$HOME/.codex/hooks/gc.py", home), `${home}/.codex/hooks/gc.py`)
  assert.equal(expandirHome("%USERPROFILE%\\.codex\\hooks\\gc.py", home), `${home}\\.codex\\hooks\\gc.py`)
  // Forma desconhecida NÃO é expandida — fingir que resolve seria pior que recusar.
  assert.equal(expandirHome("$XDG_CONFIG/gc.py", home), "$XDG_CONFIG/gc.py")
})

test("`dentroDeRaizPermitida` recusa escapada por `..`", async () => {
  const { dentroDeRaizPermitida } = await imp()
  const raiz = path.join(tmpdir(), "raiz")
  assert.equal(dentroDeRaizPermitida(path.join(raiz, "a", "gc.py"), [raiz]), true)
  assert.equal(dentroDeRaizPermitida(path.join(raiz, "..", "fora", "gc.py"), [raiz]), false)
  assert.equal(dentroDeRaizPermitida(raiz, [raiz]), false, "a própria raiz não é um arquivo dentro dela")
})
