import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanupTmp } from "./helpers/tmp.js"
import {
  snapshotDoWorkspace, divergenciaDoWorkspace, pathsDivergentes,
  motivoParaNaoConcluir, houveVerificacao, ehRepositorio, caminhosSujos, TETO_DE_CAMINHOS,
} from "../src/runtime/workspace-snapshot.js"

/**
 * PRD54 §2.2 (S54.3) — o workspace fixado durante um run.
 *
 * O §2.2 proíbe "resultado verde, JSON vazio ou evidência parcial tratada como
 * conclusão" quando o workspace muda debaixo do run.
 *
 * O CASO REAL É DESTA SESSÃO, e não do PRD. Durante o S52.N, uma execução da
 * suíte devolveu 119 falhas porque outra sessão reverteu arquivos na mesma
 * árvore no meio da corrida. A medição era de uma árvore que já não existia — e
 * a primeira leitura que fiz culpou o produto. Nada avisou, porque nada olhava.
 * O repositório convivia com isso por DISCIPLINA ("nunca editar durante proof em
 * bg", escrito desde o PRD41), que é a definição de invariante não-aplicada.
 */

const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" })

/** Um repositório de verdade — o snapshot lê git, então mock não provaria nada. */
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-ws-"))
  git(["init", "-q"], dir)
  git(["config", "user.email", "t@t.t"], dir)
  git(["config", "user.name", "t"], dir)
  writeFileSync(path.join(dir, "a.txt"), "um\n")
  git(["add", "-A"], dir)
  git(["commit", "-q", "-m", "inicial"], dir)
  return dir
}

// ── O snapshot ──────────────────────────────────────────────────────────────

test("o snapshot FIXA o commit e devolve hash reproduzível de árvore parada", () => {
  const dir = repo()
  try {
    const a = snapshotDoWorkspace({ cwd: dir })
    const b = snapshotDoWorkspace({ cwd: dir })
    assert.equal(a.available, true)
    assert.match(a.sourceCommit, /^[0-9a-f]{40}$/)
    assert.equal(a.workspaceSnapshotHash, b.workspaceSnapshotHash, "árvore parada tem de dar o mesmo hash")
    assert.equal(a.truncated, false)
  } finally { cleanupTmp(dir) }
})

test("arquivo NOVO muda o hash e aparece como caminho divergente", () => {
  const dir = repo()
  try {
    const antes = snapshotDoWorkspace({ cwd: dir })
    writeFileSync(path.join(dir, "b.txt"), "dois\n")
    const depois = snapshotDoWorkspace({ cwd: dir })

    assert.notEqual(antes.workspaceSnapshotHash, depois.workspaceSnapshotHash)
    const d = divergenciaDoWorkspace(antes, depois)
    assert.equal(d.changed, true)
    assert.equal(d.kind, "workspace_changed")
    assert.deepEqual(d.paths, ["b.txt"])
  } finally { cleanupTmp(dir) }
})

/**
 * A RAZÃO DE HASHEAR CONTEÚDO, e não só a linha do `git status`.
 *
 * Um arquivo que já estava ` M` antes do run e é editado DE NOVO durante ele
 * mantém exatamente a mesma linha de status. Uma régua que parasse no status
 * veria estabilidade onde houve mudança — e o modo de falha seria silencioso.
 */
test("arquivo JÁ sujo, editado de novo, é detectado (status igual, conteúdo diferente)", () => {
  const dir = repo()
  try {
    writeFileSync(path.join(dir, "a.txt"), "editado uma vez\n")
    const antes = snapshotDoWorkspace({ cwd: dir })
    assert.equal(antes.observedPaths[0].status, "M")

    writeFileSync(path.join(dir, "a.txt"), "editado DUAS vezes\n")
    const depois = snapshotDoWorkspace({ cwd: dir })
    assert.equal(depois.observedPaths[0].status, "M", "o status do git NÃO mudou — é esse o ponto")

    const d = divergenciaDoWorkspace(antes, depois)
    assert.equal(d.changed, true, "e ainda assim a mudança precisa ser vista")
    assert.deepEqual(d.paths, ["a.txt"])
  } finally { cleanupTmp(dir) }
})

/** O caso que me mordeu: a outra sessão REVERTEU, e reverter também é mudar. */
test("REVERTER um arquivo sujo é mudança — foi assim que a suíte mediu o vazio", () => {
  const dir = repo()
  try {
    writeFileSync(path.join(dir, "a.txt"), "modificado\n")
    const antes = snapshotDoWorkspace({ cwd: dir })
    assert.equal(antes.observedPaths.length, 1)

    git(["checkout", "--", "a.txt"], dir) // exatamente o que a outra sessão fez
    const depois = snapshotDoWorkspace({ cwd: dir })
    assert.equal(depois.observedPaths.length, 0)

    const d = divergenciaDoWorkspace(antes, depois)
    assert.equal(d.changed, true)
    assert.deepEqual(d.paths, ["a.txt"])
  } finally { cleanupTmp(dir) }
})

test("commit NOVO durante o run é `commit_changed`, e não se confunde com arquivo", () => {
  const dir = repo()
  try {
    const antes = snapshotDoWorkspace({ cwd: dir })
    writeFileSync(path.join(dir, "b.txt"), "dois\n")
    git(["add", "-A"], dir)
    git(["commit", "-q", "-m", "segundo"], dir)

    const d = divergenciaDoWorkspace(antes, snapshotDoWorkspace({ cwd: dir }))
    assert.equal(d.kind, "commit_changed", "trocar o HEAD é mais grave que sujar arquivo e tem nome próprio")
    assert.match(d.detail, /→/)
  } finally { cleanupTmp(dir) }
})

// ── Ausência: as duas espécies, que não podem ser tratadas igual ────────────

/**
 * `no_git` é limite ESTRUTURAL. Bloquear o `verify` de um projeto sem
 * repositório seria punir o usuário por não usar git — e o `verify` existe
 * justamente para projetos que ainda estão nascendo.
 */
test("fora de repositório git: NÃO bloqueia, mas também NÃO afirma estabilidade", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-sem-git-"))
  try {
    const s = snapshotDoWorkspace({ cwd: dir })
    assert.equal(s.available, false)
    assert.equal(s.code, "no_git")

    const d = divergenciaDoWorkspace(s, s)
    assert.equal(motivoParaNaoConcluir(d), null, "sem git não há acusação de instabilidade")
    assert.equal(houveVerificacao(d), false, "e também não há verificação — as duas coisas são distintas")
  } finally { cleanupTmp(dir) }
})

test("CONTROLE NEGATIVO: snapshot ausente de um lado NUNCA vira `changed: false`", () => {
  const dir = repo()
  try {
    const bom = snapshotDoWorkspace({ cwd: dir })
    const d = divergenciaDoWorkspace(bom, null)
    assert.equal(d.changed, null, "ausência de medição não é prova de estabilidade")
    assert.equal(houveVerificacao(d), false)
    assert.ok(motivoParaNaoConcluir(d), "e precisa bloquear, porque a medição existia e sumiu")
  } finally { cleanupTmp(dir) }
})

test("erro de git (não `no_git`) BLOQUEIA — a medição era possível e falhou", () => {
  const falho = { available: false, code: "git_error", reason: "git indisponível: boom" }
  const d = divergenciaDoWorkspace(falho, falho)
  assert.equal(d.kind, "git_error")
  assert.match(motivoParaNaoConcluir(d), /não verificável/)
})

// ── Régua e limites ─────────────────────────────────────────────────────────

test("`pathsDivergentes` pega adição, remoção e alteração — nas duas direções", () => {
  const antes = [{ path: "a", contentHash: "1" }, { path: "b", contentHash: "2" }]
  const depois = [{ path: "b", contentHash: "9" }, { path: "c", contentHash: "3" }]
  assert.deepEqual(pathsDivergentes(antes, depois), ["a", "b", "c"])
  assert.deepEqual(pathsDivergentes(antes, antes), [])
})

test("caminho com espaço e acento sobrevive à leitura (por isso `-z`)", () => {
  const dir = repo()
  try {
    mkdirSync(path.join(dir, "pasta com espaço"), { recursive: true })
    writeFileSync(path.join(dir, "pasta com espaço", "ação.txt"), "x\n")
    const sujos = caminhosSujos(dir)
    assert.ok(sujos.some((c) => c.path.includes("pasta com espaço/ação.txt")),
      `o formato normal do git escaparia isto com aspas; veio: ${JSON.stringify(sujos.map((c) => c.path))}`)
  } finally { cleanupTmp(dir) }
})

test("`ehRepositorio` distingue repositório de diretório qualquer", () => {
  const r = repo()
  const nada = mkdtempSync(path.join(tmpdir(), "gstack-nada-"))
  try {
    assert.equal(ehRepositorio(r), true)
    assert.equal(ehRepositorio(nada), false)
  } finally { cleanupTmp(r); cleanupTmp(nada) }
})

/**
 * O teto existe porque uma árvore com dez mil arquivos sujos existe. Acima dele
 * a garantia é MAIS FRACA e precisa dizer que é — `truncated` é o que impede um
 * snapshot parcial de parecer completo.
 */
test("acima do teto o snapshot sai `truncated`, e o hash ainda distingue árvores", () => {
  const dir = repo()
  try {
    for (let i = 0; i < TETO_DE_CAMINHOS + 5; i++) writeFileSync(path.join(dir, `f${i}.txt`), String(i))
    const a = snapshotDoWorkspace({ cwd: dir })
    assert.equal(a.truncated, true)
    assert.equal(a.observedPaths.length, TETO_DE_CAMINHOS)

    // Um arquivo A MAIS, fora da fatia observada, ainda muda o hash: `dirtyCount`
    // entra no hash justamente para que truncar não achate árvores diferentes.
    writeFileSync(path.join(dir, "extra.txt"), "x")
    assert.notEqual(snapshotDoWorkspace({ cwd: dir }).workspaceSnapshotHash, a.workspaceSnapshotHash)
  } finally { cleanupTmp(dir) }
})

test("árvore limpa: zero caminhos observados e `changed: false` honesto", () => {
  const dir = repo()
  try {
    const s = snapshotDoWorkspace({ cwd: dir })
    assert.deepEqual(s.observedPaths, [])
    const d = divergenciaDoWorkspace(s, snapshotDoWorkspace({ cwd: dir }))
    assert.equal(d.changed, false)
    assert.equal(houveVerificacao(d), true)
    assert.equal(motivoParaNaoConcluir(d), null)
  } finally { cleanupTmp(dir) }
})

/**
 * O FURO QUE ESTE TESTE FECHA, e que só apareceu porque outro teste falhou.
 *
 * Por default o `git status` COLAPSA diretório não-rastreado numa entrada só
 * (`pasta/`). `readFileSync` de diretório lança, então o hash daquela entrada
 * ficava constante — e mexer no conteúdo da pasta nova não mudava o snapshot. A
 * aparição da pasta era vista; o que crescia dentro dela, não. `-uall` lista
 * arquivo, não pasta.
 *
 * Foi um teste de FORMATO (caminho com espaço e acento) que revelou um furo de
 * COBERTURA — a asserção falhou por um motivo diferente do que eu procurava, e
 * ler o motivo de verdade em vez de ajustar a asserção é o que fez a diferença.
 */
test("conteúdo dentro de pasta NOVA é observado — o git colapsaria a pasta", () => {
  const dir = repo()
  try {
    mkdirSync(path.join(dir, "nova"), { recursive: true })
    writeFileSync(path.join(dir, "nova", "x.txt"), "antes\n")
    const antes = snapshotDoWorkspace({ cwd: dir })
    assert.ok(antes.observedPaths.some((p) => p.path === "nova/x.txt"),
      `precisa observar o ARQUIVO; veio ${JSON.stringify(antes.observedPaths.map((p) => p.path))}`)

    writeFileSync(path.join(dir, "nova", "x.txt"), "depois\n")
    const d = divergenciaDoWorkspace(antes, snapshotDoWorkspace({ cwd: dir }))
    assert.equal(d.changed, true, "com a pasta colapsada, esta mudança era invisível")
    assert.deepEqual(d.paths, ["nova/x.txt"])
  } finally { cleanupTmp(dir) }
})

/**
 * UM RUN NÃO PODE DETECTAR A SI MESMO.
 *
 * O `verify` escreve `.gstack/runs/<id>/verify.progress.jsonl` a cada passo. Sem
 * esta exclusão, todo run se declararia inconclusivo por causa da própria
 * respiração — e foi exatamente o que o primeiro teste de wiring mediu:
 * `stable: false` numa árvore que ninguém tocou. No repositório do GStack
 * `.gstack/` é gitignored e o furo não aparecia; num projeto de usuário sem essa
 * linha, apareceria em todo run.
 */
test("o estado do PRÓPRIO GStack não conta como mudança de workspace", () => {
  const dir = repo()
  try {
    const antes = snapshotDoWorkspace({ cwd: dir })
    mkdirSync(path.join(dir, ".gstack", "runs", "abc"), { recursive: true })
    writeFileSync(path.join(dir, ".gstack", "runs", "abc", "verify.progress.jsonl"), '{"id":"lint"}\n')

    const depois = snapshotDoWorkspace({ cwd: dir })
    assert.deepEqual(divergenciaDoWorkspace(antes, depois).changed, false,
      "o run veria a si mesmo e se declararia inconclusivo para sempre")
    assert.equal(depois.observedPaths.some((p) => p.path.startsWith(".gstack/")), false)
  } finally { cleanupTmp(dir) }
})

/** CONTROLE NEGATIVO: a exclusão é ESTREITA — nada além de `.gstack/` some. */
test("CONTROLE NEGATIVO: a exclusão não engole código do usuário", () => {
  const dir = repo()
  try {
    const antes = snapshotDoWorkspace({ cwd: dir })
    // Nomes vizinhos que NÃO podem ser confundidos com o diretório de estado.
    writeFileSync(path.join(dir, ".gstackrc"), "x\n")
    mkdirSync(path.join(dir, "src", ".gstack-ish"), { recursive: true })
    writeFileSync(path.join(dir, "src", ".gstack-ish", "y.txt"), "y\n")

    const d = divergenciaDoWorkspace(antes, snapshotDoWorkspace({ cwd: dir }))
    assert.equal(d.changed, true, "prefixo parecido não é o diretório de estado")
    assert.deepEqual(d.paths, [".gstackrc", "src/.gstack-ish/y.txt"])
  } finally { cleanupTmp(dir) }
})
