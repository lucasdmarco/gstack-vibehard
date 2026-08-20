/**
 * Poda de hooks ORFAOS — os que o pacote deixou de distribuir (PRD52 S52.N).
 *
 * Achado numa maquina real, com instalacao de junho atualizada para a 5.108.0:
 * o `doctor` listava 16 hooks Python, e um deles era `before_shell.py` — hook
 * REMOVIDO no PRD51 porque nenhum harness o registrava e sua unica capacidade
 * ja vivia em `pre_tool_use_security.py`. Ele nao esta no pacote nem no repo,
 * mas continuava no disco: `refreshHooks` copia tudo o que o pacote tem e nunca
 * remove o que o pacote perdeu.
 *
 * Nao e perigoso — nada invoca o arquivo. E um inventario que envelheceu: o
 * `doctor` afirmava "16 hooks instalados" contando um que o produto nao
 * distribui, e um diagnostico que conta a mais nao serve para diagnosticar.
 *
 * POR QUE A PODA ALCANCA A MAQUINA DO RELATO (medido, nao suposto): o manifest
 * existe desde a v2.17.0 (3a7d513, 2026-06-17) e a v5.0.1 — a versao instalada
 * naquela maquina em 2026-06-24 — ja copiava hooks por `safeCopyFile(...,
 * { component: "hooks" })`. Logo o `before_shell.py` de la ESTA registrado como
 * nosso, e sai no proximo `install`. Se fosse anterior ao manifest, ele nao
 * sairia — e essa seria a resposta certa, nao um motivo para afrouxar a regra.
 *
 * A REGRA QUE IMPEDE ESTRAGO: so removemos o que NOS instalamos, e o manifest e
 * quem diz isso. Um `.py` que o usuario colocou na pasta de hooks nao e nosso e
 * nao sai — apagar arquivo alheio para "limpar" seria um estrago muito maior do
 * que o inventario torto que estamos consertando.
 */

import { existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

export const HOOK_PRUNE_SCHEMA = "gstack.hook-prune.v1"

/** O unico motivo de pular a poda. Codigo, para a frase nascer na camada de CLI. */
export const PODA_SEM_ORIGEM = "pacote_sem_hooks_legiveis"

/** Os hooks que o PACOTE distribui hoje. Vazio quando a origem nao existe. */
export function hooksDoPacote(hooksSource) {
  if (!existsSync(hooksSource)) return new Set()
  return new Set(readdirSync(hooksSource).filter((f) => f.endsWith(".py")))
}

/**
 * Os caminhos de hook que o MANIFEST diz que instalamos.
 *
 * Chave por caminho absoluto normalizado: o manifest guarda o destino real, e e
 * por ele que sabemos que o arquivo e nosso.
 */
export function hooksDoManifest(manifest) {
  const itens = (manifest && manifest.items) || []
  return new Set(itens
    .filter((i) => i && i.component === "hooks" && typeof i.path === "string" && i.path.endsWith(".py"))
    .map((i) => i.path.replaceAll("\\", "/")))
}

/**
 * O que deve ser podado num diretorio: nosso, presente no disco, ausente do
 * pacote.
 *
 * PURO — devolve a lista e nao remove nada. Quem remove e `podarHooks`, e a
 * separacao existe para que o calculo seja testavel sem tocar disco.
 */
export function orfaosDoDiretorio(dir, { doPacote, doManifest }) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".py"))
    .filter((f) => !doPacote.has(f))
    .map((f) => ({ file: f, path: join(dir, f) }))
    .filter((o) => doManifest.has(o.path.replaceAll("\\", "/")))
}

/**
 * Remove os orfaos dos diretorios de hook e devolve o que saiu.
 *
 * `dryRun` existe porque `uninstall --dry-run` e `doctor` precisam mostrar o
 * plano sem executa-lo — e porque um usuario merece ver o que seria apagado
 * antes de apagarmos.
 *
 * `skipped` e um CODIGO, nao uma frase. Este modulo decide; quem escreve para o
 * usuario e a camada de CLI. Devolver a frase pronta daqui a faria viajar
 * interpolada dentro de uma moldura literal la, e o censo de i18n mediria
 * exatamente o que ele existe para impedir: prosa nossa atravessando um ponto
 * traduzivel sem ser traduzida.
 */
export function podarHooks({ hooksSource, targets = [], manifest = null, dryRun = false } = {}) {
  const doPacote = hooksDoPacote(hooksSource)
  const doManifest = hooksDoManifest(manifest)
  // Sem origem legivel NAO se poda nada: um pacote que nao expoe seus hooks
  // faria a poda concluir que TODOS sao orfaos e limpar a instalacao inteira.
  if (doPacote.size === 0) return { pruned: [], skipped: PODA_SEM_ORIGEM }

  const removidos = []
  for (const dir of targets) {
    for (const orfao of orfaosDoDiretorio(dir, { doPacote, doManifest })) {
      if (!dryRun) rmSync(orfao.path, { force: true })
      removidos.push({ ...orfao, dir, removed: !dryRun })
    }
  }
  return { pruned: removidos, skipped: null }
}

