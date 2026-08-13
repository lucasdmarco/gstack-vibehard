import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * CONTRATO PUBLICO de `--version`.
 *
 * Existe para ser a evidencia da regra `cli-version-surface` (o ponto
 * `src/index.js:13`, `console.log(pkg.version)`). Sem um teste que execute o
 * BINARIO, a regra estaria afirmando "superficie publica" com base so na forma
 * do codigo — e forma nao e contrato.
 *
 * O binario vem do `bin` do package.json, nao de um caminho escrito a mao: e o
 * manifesto que decide o que e superficie publica, e a regra deriva do mesmo
 * lugar. Se `bin` deixar de apontar `src/index.js`, este teste passa a exercitar
 * o que passou a ser publico, e a classificacao muda junto.
 *
 * `-v` e testado porque EXISTE no contrato real (src/index.js:12 compara com
 * `"--version"` e `"-v"`). Nao e alias inventado aqui.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))

/** Entrypoints publicos DECLARADOS — a mesma fonte que a regra consulta. */
const binarios = Object.entries(typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin)

test("o manifesto declara ao menos um bin — sem isso o resto do arquivo nao prova nada", () => {
  assert.ok(binarios.length > 0, "`package.json.bin` vazio: nao ha superficie publica a aferir")
})

/**
 * Roda o binario num diretorio VAZIO e descartavel. O cwd limpo e parte da
 * afericao: e ele que permite afirmar que `--version` nao escreve nada.
 */
function rodarNoSandbox(binRel, flag) {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-version-"))
  try {
    const r = spawnSync("node", [path.join(repoRoot, binRel), flag], {
      cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
    })
    return { ...r, criados: readdirSync(cwd) }
  } finally { cleanupTmp(cwd) }
}

/** Execucao invalida REPROVA: sem isso, harness quebrada vira "verde". */
function assertRodou(r, nome) {
  assert.equal(r.error, undefined, `${nome}: o comando nem rodou (${r.error?.message})`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
}

for (const [nome, binRel] of binarios) {
  for (const flag of ["--version", "-v"]) {
    test(`\`${nome} ${flag}\`: exit 0, UMA linha igual a package.json.version, stderr vazio, nada escrito`, () => {
      const r = rodarNoSandbox(binRel, flag)
      assertRodou(r, `${nome} ${flag}`)

      assert.equal(r.status, 0, `exit code precisa ser 0 (foi ${r.status})`)
      assert.equal(r.stderr, "", `stderr precisa ser vazio (veio: ${JSON.stringify(r.stderr)})`)

      // UMA linha: `trim` cairia num stdout com linhas em branco no meio, e
      // "contem a versao" aceitaria banner antes dela. O contrato e a saida
      // INTEIRA ser a versao.
      const linhas = r.stdout.split("\n")
      const ultima = linhas.pop()
      assert.equal(ultima, "", "a saida precisa terminar em newline")
      assert.equal(linhas.length, 1, `stdout precisa ter exatamente UMA linha (teve ${linhas.length}: ${JSON.stringify(r.stdout)})`)
      assert.equal(linhas[0], pkg.version, "a linha precisa ser exatamente `package.json.version`")

      // Nenhum estado persistido: o comando de versao nao inicializa projeto,
      // nao cria cache e nao toca `.gstack/`.
      assert.deepEqual(r.criados, [], `\`${flag}\` nao pode criar arquivo no cwd (criou: ${r.criados.join(", ")})`)
    })
  }
}

/**
 * CONTROLE NEGATIVO do proprio teste: se a afericao passasse com qualquer saida,
 * ela nao estaria provando nada. Aqui a versao e comparada com um valor que
 * sabidamente NAO e o do manifesto — e a comparacao precisa reprovar.
 */
test("CONTROLE NEGATIVO: a afericao de igualdade REPROVA versao diferente", () => {
  assert.notEqual(pkg.version, "0.0.0-nao-e-a-versao",
    "se isto fosse igual, a assercao principal seria vacua")
  assert.throws(() => assert.equal("0.0.0-nao-e-a-versao", pkg.version),
    "a comparacao usada acima precisa mesmo falhar quando a versao diverge")
})
