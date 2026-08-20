/**
 * As OITO provas do §2.1 do PRD54, e a evidência de cada uma (S54.2).
 *
 * O portão de entrada do PRD54 nasceu declarando o P0 de runtime como `unproven`
 * por CONSTANTE, com as oito provas em prosa. Isso estava certo enquanto nenhuma
 * delas existia — e passou a estar errado no instante em que a primeira fechou.
 * Uma constante não muda quando o produto melhora; ela só muda quando alguém
 * lembra de editá-la, e "alguém lembra" é o mecanismo que este repositório passou
 * o PRD52 inteiro tirando dos gates.
 *
 * Aqui cada prova aponta para um TESTE QUE EXISTE, e `tests/gate_truth`-style: o
 * arquivo é conferido em disco e o nome do teste é procurado dentro dele. Uma
 * prova que aponta para teste inexistente, ou para um nome que ninguém escreveu,
 * cai — que é o único jeito de a lista não virar decoração.
 *
 * AS TRÊS CONDIÇÕES DA PROVA 8. O §2.1 pede 20x em "Windows normal, shell
 * restrito e CI". Só a primeira é obtenível nesta máquina. As outras duas ficam
 * `external`, nomeadas, e NÃO entram no cálculo de "provado" — declará-las por
 * analogia com a que rodou seria exatamente a frase que o §26.3 do PRD52 proíbe
 * sobre a matriz OS × Node.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const LIFECYCLE_PROOF_SCHEMA = "gstack.prd54.lifecycle-proofs.v1"

/** Estados de uma prova. `external` não é falha: é evidência que não nasce aqui. */
export const ESTADOS_DA_PROVA = Object.freeze(["proved", "unproved", "external"])

const t = (file, name) => ({ file: join("tests", file), name })

/**
 * As oito, na ordem do §2.1. `evidence` é a lista de testes que a sustentam —
 * TODOS precisam existir e conter o nome citado.
 */
export const PROVAS_DO_P0 = Object.freeze([
  {
    id: "shutdown_gracioso_bounded",
    titulo: "shutdown gracioso bounded",
    evidence: [
      t("runtime_phased_shutdown.test.js", "POSIX: pede primeiro, e quem não atende no prazo é forçado"),
      t("runtime_phased_shutdown.test.js", "REAL (Windows): o SO RECUSA o encerramento gentil de processo detached"),
    ],
    // A honestidade desta prova está no segundo teste: no Windows a fase não
    // existe, e isso é MEDIDO contra o SO em vez de assumido nos dois sentidos.
    nota: "POSIX tem pedido real (SIGTERM ao grupo); no Windows o SO recusa a forma gentil para processo detached, e a fase é pulada com motivo no recibo",
  },
  {
    id: "arvore_como_fallback",
    titulo: "encerramento da árvore como fallback",
    evidence: [
      t("runtime_phased_shutdown.test.js", "a fase forçada só alcança quem sobreviveu ao pedido"),
      t("runtime_phased_shutdown.test.js", "REAL (Windows): a fase forçada encerra o que o gentil não encerrou"),
    ],
  },
  {
    id: "handles_fechados",
    titulo: "fechamento de stdout/stderr/log/cwd handles",
    evidence: [
      t("runtime_lifecycle_proofs.test.js", "PROVA 3: depois do stop, log e cwd são REMOVÍVEIS (sem EBUSY)"),
      t("runtime_lifecycle_proofs.test.js", "PRECONDIÇÃO: o serviço de teste segura porta, log e cwd"),
    ],
    nota: "a precondição é o controle: com o processo vivo, remover o cwd FALHA — sem isso a prova passaria por vacuidade",
  },
  {
    id: "porta_liberada",
    titulo: "liberação da porta",
    evidence: [t("runtime_lifecycle_proofs.test.js", "PROVA 4: depois do stop, a porta volta a ser BINDÁVEL")],
  },
  {
    id: "estado_preservado_com_processo_vivo",
    titulo: "estado preservado enquanto houver processo vivo",
    evidence: [
      t("runtime_windows_deterministic.test.js", "CONTROLE NEGATIVO: state NÃO é limpo enquanto um pid continuar vivo"),
      t("runtime_windows_deterministic.test.js", "state É limpo quando tudo parou/já-sumiu e nada está vivo (idempotência)"),
    ],
  },
  {
    id: "retry_idempotente",
    titulo: "retry idempotente",
    evidence: [
      t("runtime_supervisor.test.js", "stopAll: mata cada pid; lida com no-pid e processo já encerrado"),
      t("runtime_windows_deterministic.test.js", "state É limpo quando tudo parou/já-sumiu e nada está vivo (idempotência)"),
    ],
  },
  {
    id: "recuperacao_pos_crash_do_manager",
    titulo: "recuperação após crash do Manager",
    evidence: [],
    // Deliberadamente VAZIA. O `dev` sai logo após spawnar (o serviço é
    // `detached`), então "crash do Manager" precisa primeiro ser DEFINIDO neste
    // desenho antes de virar experimento. Apontar para os testes de reconciliação
    // seria confortável e errado: eles provam que o `stop` classifica bem um
    // state herdado, não que o sistema se recupera de um Manager morto no meio.
    nota: "sem experimento definido: o `dev` não permanece como Manager (o serviço é detached), então o cenário precisa ser desenhado antes de medido",
  },
  {
    id: "vinte_execucoes_sem_residual",
    titulo: "20x sem processo residual em Windows normal, shell restrito e CI",
    evidence: [t("runtime_lifecycle_proofs.test.js", "PROVA 8 (parcial: Windows normal): 20 ciclos, zero residual")],
    condicoes: Object.freeze([
      { id: "windows_normal", estado: "proved" },
      { id: "shell_restrito", estado: "external", motivo: "exige sessão em shell restrito, que esta máquina não é" },
      { id: "ci", estado: "external", motivo: "exige execução no runner do GitHub" },
    ]),
    nota: "1 de 3 condições obtida aqui; as outras duas são externas e NÃO são inferidas da que rodou",
  },
])

/** O teste citado existe E contém o nome? Ler o arquivo é o que dá dentes à lista. */
export function evidenciaAusente(ev, repoRoot) {
  const caminho = join(repoRoot, ev.file)
  if (!existsSync(caminho)) return `${ev.file} não existe`
  const corpo = leitura(caminho)
  return corpo.includes(ev.name) ? null : `${ev.file} não contém o teste "${ev.name}"`
}

const leitura = (p) => { try { return readFileSync(p, "utf-8") } catch { return "" } }

/** Alguma condição da prova é externa? Então ela não fecha aqui. */
const temCondicaoExterna = (p) => (p.condicoes || []).some((c) => c.estado === "external")

/** O estado de UMA prova, derivado da evidência que existe em disco. */
export function estadoDaProva(prova, repoRoot = process.cwd()) {
  const faltando = (prova.evidence || []).map((ev) => evidenciaAusente(ev, repoRoot)).filter(Boolean)
  if (prova.evidence.length === 0) return { ...semEvidencia(prova), missing: [] }
  if (faltando.length > 0) return { id: prova.id, state: "unproved", missing: faltando }
  if (temCondicaoExterna(prova)) return { id: prova.id, state: "external", missing: [] }
  return { id: prova.id, state: "proved", missing: [] }
}

const semEvidencia = (prova) => ({ id: prova.id, state: "unproved" })

/**
 * O ledger inteiro. `complete` só é verdadeiro quando as OITO estão `proved` —
 * `external` não conta, e é essa recusa que impede o P0 de fechar por
 * conveniência quando o que falta é uma máquina que ninguém tem.
 */
export function ledgerDoP0Runtime({ repoRoot = process.cwd() } = {}) {
  const proofs = PROVAS_DO_P0.map((p) => ({ ...estadoDaProva(p, repoRoot), titulo: p.titulo, nota: p.nota || null }))
  const porEstado = (e) => proofs.filter((p) => p.state === e)
  return {
    schemaVersion: LIFECYCLE_PROOF_SCHEMA,
    total: proofs.length,
    proved: porEstado("proved").map((p) => p.id),
    unproved: porEstado("unproved").map((p) => p.id),
    external: porEstado("external").map((p) => p.id),
    complete: porEstado("proved").length === proofs.length,
    proofs,
  }
}
