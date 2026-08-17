import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Remoção do downloader remoto DUPLICADO de `src/cli/create.js`.
 *
 * `create.js` carregava sua própria cópia de `fetchRemoteScript`,
 * `execRemoteScript`, `scriptExt` e `safeDownloadAndRun` — código que baixa um
 * script pela rede e o executa — **sem um único chamador**. Superfície de ataque
 * sem comportamento em troca: o pior tipo de código morto, porque um `curl | sh`
 * adormecido continua sendo `curl | sh` no dia em que alguém o "reaproveitar".
 *
 * O QUE ESTE TESTE NÃO AFIRMA: que `safeDownloadAndRun` seja ruim. A
 * implementação de `src/installer/install.js` é VIVA, tem três consumidores
 * reais (Bun, uv, rustup) e é a que o hook `before_shell.py` recomenda contra
 * pipe-to-shell. O que foi removido é a duplicata inalcançável.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel) => readFileSync(path.join(repoRoot, rel), "utf8")

const REMOVIDOS = ["fetchRemoteScript", "execRemoteScript", "scriptExt", "safeDownloadAndRun"]

// ── A cópia morta saiu ──────────────────────────────────────────────────────

test("`create.js` não define mais nenhum downloader remoto", () => {
  const fonte = ler("src/cli/create.js")
  for (const nome of REMOVIDOS) {
    assert.doesNotMatch(fonte, new RegExp(`function\\s+${nome}\\s*\\(`), `\`${nome}\` voltou a ser definida`)
    assert.equal(fonte.includes(nome), false, `\`${nome}\` ainda é mencionada`)
  }
  assert.equal(fonte.includes("checkRemoteDownload"), false,
    "o import da política remota saiu junto — sem downloader, não há o que autorizar")
})

/**
 * A prova que justifica a remoção: busca ESTRUTURAL por consumidores. Se algum
 * dia alguém importar essas funções de `create.js`, este teste é quem avisa —
 * antes, a ausência de chamador era invisível.
 */
/**
 * `:!*.json` exclui os REGISTROS DE DECISÃO (`i18n-js-*.json`), e a distinção é
 * a que este teste sempre quis fazer: CITAR uma função pelo nome, numa evidência
 * de decisão de i18n, não é CONSUMI-LA. As decisões nomeiam o callsite de
 * propósito — é isso que as torna auditáveis —, e sem esta exclusão o guarda
 * reprovaria a documentação em vez de um consumidor real.
 */
test("nenhum consumidor no repositório referenciava a cópia de `create.js`", () => {
  const saida = execFileSync("git",
    ["grep", "-n", "-E", REMOVIDOS.join("|"), "--", "src", "scripts", "bin", ":!*.json"],
    { cwd: repoRoot, encoding: "utf-8" })
  const linhas = saida.split("\n").filter(Boolean)

  for (const l of linhas) {
    assert.ok(!l.startsWith("src/cli/create.js:"), `create.js voltou a referenciar downloader remoto: ${l}`)
  }
  assert.ok(linhas.every((l) => l.startsWith("src/installer/install.js:")),
    `só a implementação viva do instalador pode aparecer; veio:\n${linhas.join("\n")}`)
})

// ── A implementação VIVA continua intacta ───────────────────────────────────

test("`install.js` mantém seu `safeDownloadAndRun` COM consumidores reais", () => {
  const fonte = ler("src/installer/install.js")
  assert.match(fonte, /function safeDownloadAndRun\s*\(/, "a implementação viva não pode ter sido tocada")

  // Bun, uv e rustup — os três consumidores que a tornam viva.
  const chamadas = (fonte.match(/safeDownloadAndRun\(/g) || []).length
  assert.ok(chamadas >= 4, `esperada a definição mais os consumidores; achei ${chamadas} ocorrências`)
  assert.match(fonte, /checkRemoteDownload/, "a política de allowlist continua aplicada onde há download")
})

test("`--allow-remote-downloads` continua REAL onde tem efeito", () => {
  assert.match(ler("src/installer/install.js"), /allowRemote:\s*args\.includes\("--allow-remote-downloads"\)/,
    "a flag governa o downloader vivo do instalador")
  assert.match(ler("src/installer/remote-policy.js"), /--allow-remote-downloads/,
    "e a política a menciona ao recusar")
})

/**
 * Resíduo que a remoção tornou visível, e que já existia antes dela:
 * `initAtomic` recebia `{ allowRemote }` e NUNCA o lia — ele chama
 * `installAtomicViaCargo`, que compila via `cargo` e não baixa script algum.
 * Flag encaminhada e ignorada é o mesmo padrão de "flag anunciada e inerte" que
 * o S51.9.3 já corrigiu noutro comando.
 */
test("`create.js` não encaminha mais opção que ninguém lê", () => {
  const fonte = ler("src/cli/create.js")
  assert.doesNotMatch(fonte, /initAtomic\([^)]*allowRemote/,
    "`initAtomic` não consome `allowRemote`; passá-lo simularia um controle que não existe")
  assert.match(fonte, /function initAtomic\(logger, projectDir\)/,
    "a assinatura declara exatamente o que a função usa")
  // A flag pode ser MENCIONADA em comentário — explicar onde ela vale é
  // documentação legítima. O que não pode é ser LIDA de `args`, porque aí
  // create.js voltaria a simular um controle que não exerce.
  assert.doesNotMatch(fonte, /args\.includes\("--allow-remote-downloads"\)/,
    "ler a flag sem ter downloader é anunciar um controle inexistente")
})

// ── Efeito medido no inventário ─────────────────────────────────────────────

test("a remoção elimina exatamente os 5 pontos `logger.*` que ficavam abertos", async () => {
  const { analyzeFile, createAnalyzer } = await import(
    `file:///${path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs").replace(/\\/g, "/")}`)
  const a = createAnalyzer(["src/cli/create.js", "src/cli/index.js", "src/cli/diagnostic-logger.js"])
  const pts = analyzeFile("src/cli/create.js", a)
  const doLogger = pts.filter((p) => String(p.callee).startsWith("logger."))

  assert.equal(doLogger.length, 73, "78 - 5: os pontos do ramo morto saíram com ele")
  assert.equal(doLogger.filter((p) => p.audience === "unknown").length, 0,
    "todo `logger.*` remanescente tem receptor provado — não sobrou nenhum sem chamador")
})
