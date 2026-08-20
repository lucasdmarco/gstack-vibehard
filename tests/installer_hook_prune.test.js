import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanupTmp } from "./helpers/tmp.js"
import { podarHooks, orfaosDoDiretorio, hooksDoPacote, hooksDoManifest, PODA_SEM_ORIGEM } from "../src/installer/hook-prune.js"

const repoRoot = path.resolve(import.meta.dirname, "..")

/**
 * PRD52 S52.N — poda de hooks órfãos.
 *
 * O DEFEITO REAL, medido em outra máquina: instalação de 2026-06-24 (v5.0.1)
 * atualizada para a v5.108.0. O `doctor` reportou "16 hooks Python instalados"
 * e listou `before_shell.py` — hook REMOVIDO no PRD51, ausente do pacote 5.108.0
 * (0 ocorrências no tarball) e ausente do repo. `refreshHooks` copiava tudo o
 * que o pacote TEM e nunca removia o que o pacote PERDEU, então o arquivo
 * sobreviveu a todos os upgrades desde junho.
 *
 * Nenhum harness invoca o arquivo — o dano não é execução, é INVENTÁRIO: um
 * diagnóstico que conta 16 quando o produto distribui 15 não serve para
 * diagnosticar.
 *
 * O risco da correção é maior que o do defeito, e é por isso que os controles
 * negativos aqui são o coração do arquivo: uma poda que erra apaga arquivo do
 * usuário. A regra é que só sai o que o MANIFEST diz que nós instalamos.
 */

function cenario() {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-hookprune-"))
  const pacote = path.join(dir, "pacote")
  const instalado = path.join(dir, "instalado")
  mkdirSync(pacote, { recursive: true })
  mkdirSync(instalado, { recursive: true })
  writeFileSync(path.join(pacote, "atual.py"), "# distribuído hoje")
  writeFileSync(path.join(instalado, "atual.py"), "# distribuído hoje")
  writeFileSync(path.join(instalado, "orfao.py"), "# saiu do pacote")
  const manifest = {
    items: [
      { path: path.join(instalado, "atual.py"), kind: "file", component: "hooks", owner: "gstack" },
      { path: path.join(instalado, "orfao.py"), kind: "file", component: "hooks", owner: "gstack" },
    ],
  }
  return { dir, pacote, instalado, manifest }
}

test("poda remove o hook que saiu do pacote e preserva o que continua nele", () => {
  const c = cenario()
  try {
    const r = podarHooks({ hooksSource: c.pacote, targets: [c.instalado], manifest: c.manifest })
    assert.equal(r.skipped, null)
    assert.deepEqual(r.pruned.map((o) => o.file), ["orfao.py"])
    assert.equal(existsSync(path.join(c.instalado, "orfao.py")), false, "o órfão devia ter saído")
    assert.equal(existsSync(path.join(c.instalado, "atual.py")), true, "o hook vivo NÃO pode sair")
  } finally { cleanupTmp(c.dir) }
})

/**
 * CONTROLE NEGATIVO 1 — o mais importante do arquivo.
 *
 * Um `.py` que não está no manifest não é nosso. Pode ser um hook que o usuário
 * escreveu e deixou na mesma pasta. Apagá-lo para "limpar o inventário" seria
 * trocar um erro de contagem por perda de trabalho alheio.
 */
test("arquivo que NÃO está no manifest é intocável, mesmo fora do pacote", () => {
  const c = cenario()
  try {
    const alheio = path.join(c.instalado, "meu_hook_pessoal.py")
    writeFileSync(alheio, "# escrito pelo usuário")
    const r = podarHooks({ hooksSource: c.pacote, targets: [c.instalado], manifest: c.manifest })
    assert.equal(r.pruned.some((o) => o.file === "meu_hook_pessoal.py"), false)
    assert.equal(existsSync(alheio), true, "poda apagou arquivo que não instalamos")
    assert.equal(readFileSync(alheio, "utf-8"), "# escrito pelo usuário")
  } finally { cleanupTmp(c.dir) }
})

/**
 * CONTROLE NEGATIVO 2 — a falha catastrófica que a guarda impede.
 *
 * Se a origem for ilegível (pacote quebrado, caminho errado após um refactor de
 * layout), TODO hook instalado passaria a "ausente do pacote" e a poda limparia
 * a instalação inteira. Abortar é a única resposta correta: sem régua não se
 * mede, e muito menos se apaga.
 */
test("origem ilegível ABORTA a poda em vez de considerar tudo órfão", () => {
  const c = cenario()
  try {
    const r = podarHooks({ hooksSource: path.join(c.dir, "nao-existe"), targets: [c.instalado], manifest: c.manifest })
    assert.deepEqual(r.pruned, [])
    assert.equal(r.skipped, PODA_SEM_ORIGEM, "`skipped` e codigo, nao frase — a frase nasce na CLI")
    assert.equal(existsSync(path.join(c.instalado, "orfao.py")), true)
    assert.equal(existsSync(path.join(c.instalado, "atual.py")), true)
  } finally { cleanupTmp(c.dir) }
})

/** CONTROLE NEGATIVO 3 — manifest ausente: nada é nosso, nada sai. */
test("sem manifest a poda não remove nada", () => {
  const c = cenario()
  try {
    const r = podarHooks({ hooksSource: c.pacote, targets: [c.instalado], manifest: null })
    assert.deepEqual(r.pruned, [])
    assert.equal(existsSync(path.join(c.instalado, "orfao.py")), true)
  } finally { cleanupTmp(c.dir) }
})

/** `dryRun` é o modo do `doctor`: relata o plano e não toca no disco. */
test("dryRun relata o órfão sem removê-lo", () => {
  const c = cenario()
  try {
    const r = podarHooks({ hooksSource: c.pacote, targets: [c.instalado], manifest: c.manifest, dryRun: true })
    assert.deepEqual(r.pruned.map((o) => o.file), ["orfao.py"])
    assert.equal(r.pruned[0].removed, false)
    assert.equal(existsSync(path.join(c.instalado, "orfao.py")), true, "dryRun apagou — o doctor não pode apagar")
  } finally { cleanupTmp(c.dir) }
})

/** Diretório de destino ausente (harness não instalado) não é erro. */
test("alvo inexistente é ignorado sem lançar", () => {
  const c = cenario()
  try {
    const r = podarHooks({ hooksSource: c.pacote, targets: [path.join(c.dir, "sem-harness")], manifest: c.manifest })
    assert.deepEqual(r.pruned, [])
  } finally { cleanupTmp(c.dir) }
})

test("a régua lê só .py e normaliza a barra do Windows no manifest", () => {
  const c = cenario()
  try {
    writeFileSync(path.join(c.instalado, "leia.md"), "# não é hook")
    const doManifest = hooksDoManifest({ items: [{ path: path.join(c.instalado, "orfao.py"), component: "hooks" }] })
    assert.equal(doManifest.size, 1)
    assert.equal([...doManifest][0].includes("\\"), false, "caminho do manifest ficou com barra do Windows")
    const orfaos = orfaosDoDiretorio(c.instalado, { doPacote: hooksDoPacote(c.pacote), doManifest })
    assert.deepEqual(orfaos.map((o) => o.file), ["orfao.py"])
  } finally { cleanupTmp(c.dir) }
})

/**
 * REGRESSÃO DO CASO REAL: `before_shell.py` saiu do produto no PRD51. Se ele
 * (ou qualquer hook removido) voltar ao pacote sem decisão, este teste avisa —
 * e enquanto estiver fora, a poda continua sendo a resposta correta para as
 * máquinas que ainda o têm em disco.
 */
test("before_shell.py não é mais distribuído por este pacote", () => {
  const doPacote = hooksDoPacote(path.join(repoRoot, "hooks", "hooks"))
  assert.ok(doPacote.size > 0, "o repo precisa ter hooks para esta régua valer")
  assert.equal(doPacote.has("before_shell.py"), false)
  assert.equal(doPacote.has("pre_tool_use_security.py"), true, "o substituto precisa continuar no pacote")
})
