/**
 * O WORKSPACE FIXADO durante um run — §2.2 do PRD54 (S54.3).
 *
 * O §2.2: "Um run não pode observar metade de um merge ou implementação
 * concorrente. Toda missão fixa `sourceCommit`, `workspaceSnapshotHash` e paths
 * observados. Mudança externa durante execução produz `workspace_changed` e
 * checkpoint; nunca resultado verde, JSON vazio ou evidência parcial tratada
 * como conclusão."
 *
 * O ACHADO QUE ORIGINOU ESTE MÓDULO NÃO VEIO DE LEITURA DO PRD — veio de ser
 * mordido por ele. Durante o desenvolvimento do S52.N, uma execução da suíte
 * completa devolveu 119 falhas. Outra sessão, trabalhando na mesma árvore,
 * reverteu suas edições de i18n no meio da corrida. A medição era de uma árvore
 * que já não existia, e a primeira leitura que fiz dela foi a errada: atribuí as
 * falhas a um defeito do produto. Nada no relatório dizia que o chão tinha
 * mudado, porque nada olhava.
 *
 * O repositório já convivia com isso por DISCIPLINA — "nunca editar durante
 * proof em bg" está escrito desde o PRD41. Uma regra que só existe na cabeça de
 * quem lembra é a definição de invariante não-aplicada; este módulo a torna
 * mensurável.
 *
 * O QUE O SNAPSHOT VÊ, e o que não vê. Ele usa o git como fonte: HEAD mais o
 * conjunto de caminhos sujos, cada um com hash do CONTEÚDO. Hash de conteúdo, e
 * não só o status do `git status`, porque um arquivo que já estava ` M` antes do
 * run e foi editado de novo durante ele mantém exatamente a mesma linha de
 * status — a mudança seria invisível se a régua parasse ali. O que ele NÃO vê é
 * mudança em arquivo ignorado pelo git: fora do escopo, e declarado como tal em
 * vez de silenciado.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

export const WORKSPACE_SNAPSHOT_SCHEMA = "gstack.workspace-snapshot.v1"

/**
 * Teto de caminhos com hash de conteúdo.
 *
 * Uma árvore com dez mil arquivos sujos existe (merge grande, build sem
 * gitignore) e ler todos custaria mais que o run. Acima do teto, o snapshot sai
 * `truncated` — uma garantia MAIS FRACA, que precisa dizer que é mais fraca em
 * vez de parecer completa.
 */
export const TETO_DE_CAMINHOS = 500

/**
 * O QUE O SNAPSHOT NÃO OBSERVA: o estado do próprio GStack.
 *
 * UM RUN NÃO PODE DETECTAR A SI MESMO. O `verify` escreve
 * `.gstack/runs/<id>/verify.progress.jsonl` a cada passo — se isso contasse como
 * mudança de workspace, todo run se declararia inconclusivo por causa da própria
 * respiração. No repositório do GStack `.gstack/` é gitignored e o problema não
 * aparecia; num projeto de usuário sem essa linha no `.gitignore`, apareceria
 * sempre. Medido: o primeiro teste de wiring voltou `stable: false` numa árvore
 * que ninguém tocou.
 *
 * A exclusão é do DIRETÓRIO DE ESTADO da ferramenta, nunca de código do usuário.
 * Uma sessão concorrente que mexa em `.gstack/` deixa de ser vista, e isso é
 * correto: `.gstack/` é estado da ferramenta, não fonte sob teste.
 */
export const FORA_DO_ESCOPO = Object.freeze([".gstack/"])

const noEscopo = (rel) => !FORA_DO_ESCOPO.some((prefixo) => rel.startsWith(prefixo))

const sha256 = (texto) => createHash("sha256").update(texto).digest("hex")

const git = (args, cwd) => String(execFileSync("git", args, {
  cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", timeout: 20000, maxBuffer: 64 * 1024 * 1024,
}) || "")

/** É um repositório git? Sem git não há snapshot, e isso é dito, não fingido. */
export function ehRepositorio(cwd) {
  try { return git(["rev-parse", "--is-inside-work-tree"], cwd).trim() === "true" } catch { return false }
}

/** As linhas do `git status --porcelain`, já partidas em `{status, path}`. */
export function caminhosSujos(cwd) {
  const saida = git(["status", "--porcelain", "-z", "-uall"], cwd)
  // `-z` separa por NUL: caminho com espaço, acento ou aspas volta literal, sem
  // o escaping do formato normal — que exigiria desfazer aspas e sequências e é
  // exatamente onde uma régua de caminho costuma errar em silêncio.
  //
  // `-uall` lista ARQUIVO não-rastreado, e não a pasta que os contém. O default
  // do git colapsa um diretório novo numa entrada só (`pasta/`), e isso abria um
  // furo medido: `readFileSync` de diretório lança, o hash daquela entrada era
  // constante, e mexer no CONTEÚDO da pasta nova não mudava o snapshot. A
  // aparição da pasta era vista; o que crescia dentro dela, não.
  return saida.split("\0").filter(Boolean).map((entrada) => ({
    status: entrada.slice(0, 2).trim(),
    // Barra normalizada: a comparação com `FORA_DO_ESCOPO` precisa ser estável
    // entre plataformas.
    path: entrada.slice(3).replaceAll("\\", "/"),
  })).filter((c) => noEscopo(c.path))
}

/** Hash do conteúdo de um caminho, ou o marcador de ausente. */
function hashDoCaminho(cwd, rel) {
  const abs = join(cwd, rel)
  if (!existsSync(abs)) return "ausente"
  try { return sha256(readFileSync(abs)) } catch { return "ilegivel" }
}

/**
 * O snapshot do workspace: commit fixado, caminhos observados e um hash que
 * muda se qualquer um deles mudar.
 *
 * `sourceCommit` é lido AQUI e não no fim do run: o §2.2 fala em FIXAR, e um
 * commit lido no fim descreve a árvore que sobrou, não a que foi medida.
 */
export function snapshotDoWorkspace({ cwd = process.cwd(), agora = null } = {}) {
  if (!ehRepositorio(cwd)) return indisponivel("no_git", "não é um repositório git — não há como fixar o workspace")
  try { return snapshotReal(cwd, agora) } catch (e) {
    return indisponivel("git_error", `git indisponível: ${String(e.message || e).slice(0, 120)}`)
  }
}

/**
 * `code` separa DUAS ausências que não podem ser tratadas igual.
 *
 * `no_git` é um limite ESTRUTURAL: um projeto scaffold sem repositório não tem
 * como ser fotografado, e nunca teve. Bloquear o `verify` dele seria punir o
 * usuário por não usar git — e o `verify` existe justamente para projetos que
 * ainda estão nascendo.
 *
 * `git_error` é outra coisa: o repositório existe e a medição FALHOU. Aí a
 * ausência é suspeita, e o §2.2 manda não concluir.
 */
const indisponivel = (code, motivo) => ({
  schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA,
  available: false, code, reason: motivo,
  sourceCommit: null, workspaceSnapshotHash: null, observedPaths: [], truncated: false,
})

function snapshotReal(cwd, agora) {
  const sourceCommit = git(["rev-parse", "HEAD"], cwd).trim() || null
  const sujos = caminhosSujos(cwd)
  const truncated = sujos.length > TETO_DE_CAMINHOS
  const observados = sujos.slice(0, TETO_DE_CAMINHOS)
    .map((c) => ({ path: c.path, status: c.status, contentHash: hashDoCaminho(cwd, c.path) }))
    .sort((a, b) => a.path.localeCompare(b.path))

  return {
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA,
    available: true,
    reason: null,
    sourceCommit,
    // O hash cobre o commit E cada caminho sujo com seu conteúdo. `dirtyCount`
    // entra para que truncar mude o hash — senão duas árvores diferentes acima
    // do teto teriam a mesma impressão.
    workspaceSnapshotHash: sha256(JSON.stringify({ sourceCommit, dirtyCount: sujos.length, observados })),
    observedPaths: observados,
    truncated,
    takenAt: agora || new Date().toISOString(),
  }
}

/**
 * O que mudou entre dois snapshots.
 *
 * `changed: false` NUNCA é devolvido quando um dos lados está indisponível —
 * ausência de medição não é prova de estabilidade, e é justamente aí que o
 * silêncio vira "verde" falso.
 */
export function divergenciaDoWorkspace(antes, depois) {
  if (!antes || !depois) return incomparavel("git_error", "snapshot ausente em um dos lados")
  const indisponivelDosDois = [antes, depois].find((s) => !s.available)
  if (indisponivelDosDois) return incomparavel(indisponivelDosDois.code, indisponivelDosDois.reason)
  if (antes.sourceCommit !== depois.sourceCommit) {
    return { comparable: true, changed: true, kind: "commit_changed", detail: `${antes.sourceCommit} → ${depois.sourceCommit}`, paths: [] }
  }
  const mudados = pathsDivergentes(antes.observedPaths, depois.observedPaths)
  if (mudados.length === 0) return { comparable: true, changed: false, kind: null, detail: null, paths: [] }
  return { comparable: true, changed: true, kind: "workspace_changed", detail: `${mudados.length} caminho(s) mudaram durante o run`, paths: mudados }
}

const incomparavel = (code, motivo) => ({ comparable: false, changed: null, kind: code, detail: motivo, paths: [] })

/** Os caminhos cuja presença ou conteúdo diferem entre os dois lados. */
export function pathsDivergentes(antes, depois) {
  const mapa = (lista) => new Map((lista || []).map((p) => [p.path, p.contentHash]))
  const a = mapa(antes)
  const b = mapa(depois)
  const todos = new Set([...a.keys(), ...b.keys()])
  return [...todos].filter((p) => a.get(p) !== b.get(p)).sort()
}

/**
 * O veredito do run pode ser levado a sério?
 *
 * Devolve o motivo pelo qual NÃO pode, ou `null`. Chão que se moveu e chão que
 * ninguém mediu caem no mesmo lugar, e de propósito: o §2.2 proíbe tratar
 * evidência parcial como conclusão, e "não sei se mudou" é evidência parcial.
 */
export function motivoParaNaoConcluir(divergencia) {
  if (!divergencia) return "sem verificação de workspace"
  if (divergencia.changed === true) return `${divergencia.kind}: ${divergencia.detail}`
  // `no_git` NÃO bloqueia: é limite estrutural declarado, não medição perdida.
  // O relatório continua dizendo que não houve verificação — o que muda é que
  // um projeto sem repositório não é acusado de instabilidade que ninguém viu.
  if (divergencia.kind === "no_git") return null
  if (divergencia.comparable === false) return `workspace não verificável (${divergencia.detail})`
  return null
}

/** Houve verificação de verdade? `no_git` é ausência honesta, não estabilidade. */
export const houveVerificacao = (divergencia) => Boolean(divergencia) && divergencia.comparable === true
