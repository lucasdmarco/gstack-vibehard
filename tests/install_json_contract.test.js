import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"
import { evaluateJsonRun } from "./helpers/json-purity.js"

/**
 * CONSUMIDOR REAL de `install --audit-only --json`.
 *
 * Evidência da declaração de consumidor de `src/installer/install.js`. O ponto de
 * máquina é `:475`, e o comando é o ÚNICO do produto que pode gravar no HOME do
 * usuário — por isso a prova roda num ambiente inteiramente DESCARTÁVEL.
 *
 * `--audit-only` é o oráculo seguro por construção: P0.3 garante READ-ONLY sem
 * `--save-report`. A asserção mais forte deste arquivo vem daí — não é "escreveu
 * só onde podia", é ZERO ESCRITA. Uma allowlist não-vazia aqui já seria um
 * afrouxamento.
 *
 * AMBIENTE DESCARTÁVEL, e completo: HOME e USERPROFILE (o `homedir()` do Node usa
 * um em POSIX e o outro no Windows), TMPDIR/TEMP/TMP, os três XDG, APPDATA e
 * LOCALAPPDATA. Nenhuma configuração, hook, token, cache ou credencial real é
 * lida — e há controle provando que o `impact` aponta para DENTRO do sandbox, o
 * que só acontece se a troca de HOME tiver pegado.
 *
 * `NODE_DISABLE_COMPILE_CACHE` não é detalhe: sem ele o próprio Node grava o
 * cache de compilação em TMPDIR, e a contagem de escritas mediria o runtime em
 * vez do produto.
 *
 * FALHA DE PREPARO DO SANDBOX é `test_environment_invalid` — não é defeito do
 * produto, e o teste diz isso com todas as letras em vez de reprovar o GStack.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

/** Árvore completa do sandbox: caminho relativo -> tamanho+mtime. */
function snapshot(raiz) {
  const saida = new Map()
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome)
      const st = statSync(p)
      if (st.isDirectory()) andar(p)
      else saida.set(path.relative(raiz, p), `${st.size}|${st.mtimeMs}`)
    }
  }
  andar(raiz)
  return saida
}

const SUBDIRS = ["home", "tmp", "xdg", "appdata", "local", "cwd"]

/**
 * Ambiente descartável. Qualquer falha aqui é do AMBIENTE, e é sinalizada como
 * tal — reprovar o produto por não conseguir criar um diretório seria medir a
 * própria harness.
 */
function sandbox(t) {
  let raiz
  try {
    raiz = mkdtempSync(path.join(tmpdir(), "gstack-install-"))
    for (const d of SUBDIRS) mkdirSync(path.join(raiz, d), { recursive: true })
  } catch (e) {
    assert.fail(`test_environment_invalid: não consegui preparar o sandbox (${e.code || e.message})`)
  }
  t.after(() => cleanupTmp(raiz))

  const dentro = (d) => path.join(raiz, d)
  const env = {
    ...process.env,
    HOME: dentro("home"), USERPROFILE: dentro("home"),
    TMPDIR: dentro("tmp"), TEMP: dentro("tmp"), TMP: dentro("tmp"),
    XDG_CONFIG_HOME: dentro("xdg"), XDG_DATA_HOME: dentro("xdg"), XDG_CACHE_HOME: dentro("xdg"),
    APPDATA: dentro("appdata"), LOCALAPPDATA: dentro("local"),
    NPM_CONFIG_CACHE: dentro("tmp"),
    // Sem isto o Node grava o cache de compilação em TMPDIR e a contagem de
    // escritas passa a medir o runtime, não o instalador.
    NODE_DISABLE_COMPILE_CACHE: "1",
  }
  return { raiz, env, cwd: dentro("cwd") }
}

const rodar = (sb, args) => evaluateJsonRun(spawnSync("node", [bin, "install", ...args], {
  cwd: sb.cwd, env: sb.env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 240000,
}))

function assertRodou(r, nome) {
  assert.equal(r.spawnFailed, false, `test_environment_invalid: spawn falhou em ${nome}`)
  assert.equal(r.timedOut, false, `test_environment_invalid: timeout em ${nome}`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execução inválida`)
}

// ── O ponto de máquina `:475` ──────────────────────────────────────────────

test("`install --audit-only --json`: documento puro, com o schema do preflight", (t) => {
  const sb = sandbox(t)
  const r = rodar(sb, ["--audit-only", "--json"])
  assertRodou(r, "audit-only --json")

  assert.equal(r.pure, true, `stdout não é documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, "payload de máquina não pode sair pelo stderr")
  assert.equal(r.exitCode, 0, "preflight bem-sucedido sai 0 — é o contrato atual")

  const p = r.doc
  assert.equal(p.schemaVersion, "gstack.install-audit.v1")
  assert.equal(p.readOnly, true, "o payload declara a própria natureza — é o que autoriza automação a rodá-lo")
  assert.ok(Array.isArray(p.impact) && p.impact.length > 0, "o consumidor precisa do impacto por categoria")
  assert.ok(Array.isArray(p.predictedDegradations), "degradações previstas entram no contrato, mesmo vazias")
  for (const cat of p.impact) {
    assert.equal(typeof cat.category, "string")
    assert.ok(Array.isArray(cat.items), `categoria \`${cat.category}\` precisa listar itens`)
  }
})

/**
 * A ASSERÇÃO CENTRAL, e ela é ZERO — não "escreveu só onde podia". `--audit-only`
 * sem `--save-report` promete não gravar nada (P0.3), e a promessa é verificável
 * comparando a árvore inteira do ambiente descartável antes e depois.
 */
test("`--audit-only` não escreve NADA no ambiente descartável", (t) => {
  const sb = sandbox(t)
  const antes = snapshot(sb.raiz)

  const r = rodar(sb, ["--audit-only", "--json"])
  assertRodou(r, "audit-only --json")

  const depois = snapshot(sb.raiz)
  const novos = [...depois.keys()].filter((k) => !antes.has(k))
  const mudados = [...depois.keys()].filter((k) => antes.has(k) && antes.get(k) !== depois.get(k))
  const sumidos = [...antes.keys()].filter((k) => !depois.has(k))

  assert.deepEqual(novos, [], `audit-only gravou arquivo novo: ${novos.join(", ")}`)
  assert.deepEqual(mudados, [], `audit-only alterou arquivo: ${mudados.join(", ")}`)
  assert.deepEqual(sumidos, [], `audit-only removeu arquivo: ${sumidos.join(", ")}`)
})

/**
 * O sandbox PEGOU — e sem isto as duas asserções acima seriam vazias: se o
 * `HOME` real tivesse sido usado, o impacto apontaria para fora e a contagem de
 * escritas no sandbox daria zero por não haver nada lá.
 */
test("CONTROLE: o impacto aponta para DENTRO do sandbox, não para o HOME real", (t) => {
  const sb = sandbox(t)
  const r = rodar(sb, ["--audit-only", "--json"])
  assertRodou(r, "audit-only --json")

  const caminhos = r.doc.impact.flatMap((c) => c.items.map((i) => String(i.path ?? "")))
  const doHome = caminhos.filter((p) => p.includes(".gstack") || p.includes(".codex") || p.includes(".claude"))
  assert.ok(doHome.length > 0, "o preflight precisa listar caminhos do HOME")

  const raizReal = path.resolve(sb.raiz)
  assert.ok(doHome.some((p) => path.resolve(p).startsWith(raizReal)),
    "nenhum caminho caiu dentro do sandbox — a troca de HOME não pegou, e a prova não vale")
  assert.ok(!caminhos.some((p) => /[/\\]Users[/\\](?!.*gstack-install-)/.test(p) && !path.resolve(p).startsWith(raizReal)),
    "nenhum caminho pode apontar para o perfil real do usuário")
})

// ── CONTROLE NEGATIVO ──────────────────────────────────────────────────────

test("CONTROLE NEGATIVO: sem `--json`, o preflight sai em prosa", (t) => {
  const sb = sandbox(t)
  const r = rodar(sb, ["--audit-only"])
  assertRodou(r, "audit-only sem --json")
  assert.equal(r.pure, false, "no ramo humano o stdout não pode ser documento JSON puro")
})

test("CONTROLE NEGATIVO: o ramo humano também não escreve sem `--save-report`", (t) => {
  const sb = sandbox(t)
  const antes = snapshot(sb.raiz)
  assertRodou(rodar(sb, ["--audit-only"]), "audit-only sem --json")
  const depois = snapshot(sb.raiz)
  assert.deepEqual([...depois.keys()].filter((k) => !antes.has(k)), [],
    "a promessa READ-ONLY vale nos dois ramos, e não só no de máquina")
})
