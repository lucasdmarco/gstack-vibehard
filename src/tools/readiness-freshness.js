/**
 * §26.2 aplicado ao arquivo REAL — readiness ARMAZENADO tem validade (S52.D).
 *
 * `.gstack/tool-readiness.json` já declarava `generatedAt` e
 * `staleAfterSeconds: 3600`. O que faltava era alguém CONFERIR: quem lê o
 * arquivo — inclusive o agente, que o CLAUDE.md manda ler antes de explorar
 * código — via `"status": "callable"` e tratava como estado de agora, mesmo que
 * a observação fosse de meses atrás. A janela estava escrita e não valia nada.
 *
 * Este módulo lê o arquivo e devolve o estado CONSUMÍVEL de cada ferramenta:
 * `callable` continua `callable` enquanto a observação estiver dentro da janela
 * e o HEAD não tiver mudado; fora disso vira `stale`, e `stale` nunca é
 * apresentado como capacidade disponível.
 *
 * Ele NÃO sonda nada. Sondar é o `tools readiness`, que reconstrói tudo; aqui a
 * pergunta é outra e mais barata: *o que está no disco ainda pode ser usado como
 * verdade?*
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  READINESS_OBSERVATION_SCHEMA, estadoConsumivel, problemasDaObservacao,
} from "../meta/prd52-schemas.js"

export const STORED_READINESS_SCHEMA = "gstack.stored-readiness.v1"

export const READINESS_FILE = join(".gstack", "tool-readiness.json")

/** Lê o arquivo armazenado. Ausente/ilegível devolve `null` — nunca um objeto vazio que pareça dado. */
export function lerReadinessArmazenado(cwd = process.cwd()) {
  const p = join(cwd, READINESS_FILE)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null }
}

/** Ausente vira o valor declarado, e o `undefined` some num lugar só. */
const ou = (v, alt) => (v === undefined || v === null ? alt : v)

/** A sonda deixou rastro? Sem comando nem exitCode registrados, o rótulo não tem lastro. */
const temProvaDeSonda = (t) => Boolean(t.validatedCommand || t.exitCode !== undefined)
const refDaProva = (nome, t) => (temProvaDeSonda(t) ? `${nome}:exit=${ou(t.exitCode, "?")}` : null)

/**
 * Converte uma ferramenta do arquivo numa observação do §26.2.
 *
 * `probeResultRef` é o que a sonda REGISTROU (o stdout/exitCode que ficou no
 * arquivo). Sem isso a observação não tem prova de que algum comando rodou, e o
 * §26.2 manda tratá-la como `unknown` em vez de acreditar no rótulo.
 */
export function observacaoDaFerramenta(nome, tool, doc, head = null) {
  const t = tool || {}
  const d = doc || {}
  return {
    schemaVersion: READINESS_OBSERVATION_SCHEMA,
    capabilityId: nome,
    status: ou(t.status, "unknown"),
    generatedAt: ou(d.generatedAt, null),
    staleAfterSeconds: ou(d.staleAfterSeconds, null),
    sourceCommit: ou(d.headCommit, ou(d.commit, null)),
    observedHead: head,
    probeCommandRef: ou(t.validatedCommand, null),
    probeResultRef: refDaProva(nome, t),
  }
}

/**
 * O estado consumível de cada ferramenta do arquivo armazenado.
 *
 * `agoraMs` e `head` entram de fora: um módulo que lê o relógio por conta
 * própria não é testável contra uma janela, e o resultado passaria a depender do
 * dia em que a suíte roda.
 */
export function readinessConsumivel(cwd = process.cwd(), { agoraMs = Date.now(), head = null, doc = undefined } = {}) {
  const documento = doc === undefined ? lerReadinessArmazenado(cwd) : doc
  if (!documento || !documento.tools) {
    return { schemaVersion: STORED_READINESS_SCHEMA, present: false, capabilities: [], anyStale: false }
  }
  const capabilities = Object.entries(documento.tools).map(([nome, tool]) => {
    const obs = observacaoDaFerramenta(nome, tool, documento, head)
    const consumivel = estadoConsumivel(obs, agoraMs)
    return {
      capabilityId: nome,
      storedStatus: obs.status,
      consumableStatus: consumivel,
      // A degradação é DECLARADA, nunca deduzida da diferença entre os dois campos.
      degraded: consumivel !== obs.status,
      observationProblems: problemasDaObservacao(obs),
    }
  })
  return {
    schemaVersion: STORED_READINESS_SCHEMA,
    present: true,
    generatedAt: documento.generatedAt ?? null,
    staleAfterSeconds: documento.staleAfterSeconds ?? null,
    capabilities,
    anyStale: capabilities.some((c) => c.consumableStatus === "stale"),
  }
}

/**
 * A pergunta que o consumidor realmente faz: posso CONTAR com esta capacidade
 * agora, a partir do que está no disco?
 *
 * Só dois estados respondem sim. Qualquer outro — inclusive `callable` vencido —
 * responde não, e é o ponto inteiro do §26.2.
 */
const DISPONIVEIS = Object.freeze(["callable", "routed"])
export function capacidadeUtilizavel(relatorio, capabilityId) {
  const c = (relatorio?.capabilities || []).find((x) => x.capabilityId === capabilityId)
  return Boolean(c && DISPONIVEIS.includes(c.consumableStatus))
}
