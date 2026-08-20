/**
 * Os DENTES do contrato de claim (PRD52 S52.B).
 *
 * O contrato existia desde o PRD41, mas `hasBehavioralContract` só exigia que
 * os quatro campos fossem *truthy*. Uma string qualquer bastava: nada checava se
 * o adaptador existe, se o comando E2E é executável, se o controle negativo
 * aponta para um teste real, nem se esse teste sequer toca a capacidade que diz
 * proteger. Um contrato podia ser prosa bem escrita e o placar dizia REAL.
 *
 * Este módulo transforma cada campo em uma VERIFICAÇÃO EXECUTÁVEL contra o repo
 * auditado. As regras não opinam sobre qualidade — elas perguntam coisas que têm
 * resposta em disco:
 *
 *   1. o adaptador é um caminho que EXISTE (não prosa com caminho dentro);
 *   2. o comando E2E começa por um executor real e cita arquivos que existem;
 *   3. o controle negativo cita ao menos um teste que EXISTE;
 *   4. esse teste referencia o adaptador ou o entrypoint do E2E — um teste que
 *      nunca toca a capacidade não pode ser o controle negativo dela;
 *   5. o frescor vem de vocabulário FECHADO.
 *
 * O QUE ESTE MÓDULO AINDA NÃO PROVA: que o controle negativo REPROVA quando a
 * capacidade é removida. Isso exige executar o teste contra o adaptador mutado e
 * guardar recibo — é o S52.C. Até lá, a regra 4 é o limite honesto do que dá
 * para afirmar por leitura estática, e está declarada como tal.
 */

import { existsSync, readFileSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { problemas, naoEhObjeto } from "../meta/schema-rules.js"

export const CONTRACT_CHECK_SCHEMA = "gstack.claim-contract-check.v1"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * Vocabulário FECHADO de frescor — os valores que os contratos do repo já usam.
 *
 * Fechar o vocabulário é a regra; consolidar os sinônimos (`por-run`,
 * `por-execução`, `por-operação` dizem quase a mesma coisa) NÃO é feito aqui,
 * porque renomear em massa os campos existentes seria editar 24 contratos para
 * satisfazer um checker — exatamente a migração cosmética que o §placar proíbe.
 * O que a lista impede é o 16º valor entrar em silêncio.
 */
export const FRESHNESS_BASIS = Object.freeze([
  "por-ação", "por-build", "por-checkpoint", "por-ciclo", "por-diagnóstico",
  "por-execução", "por-fix", "por-instalação", "por-observação", "por-operação",
  "por-release", "por-revogação", "por-run", "por-sessão", "por-turno",
])

/** Executores reconhecidos: um comando E2E precisa começar por algo que roda. */
const EXECUTORES = Object.freeze(["node", "npm", "npx", "python", "python3", "bash", "pwsh"])

/** Leitor do repo auditado — o mesmo formato que o auditor já injeta. */
export function leitorPadrao(root = REPO_ROOT) {
  return {
    has: (rel) => existsSync(join(root, rel)),
    read: (rel) => {
      try { return readFileSync(join(root, rel), "utf-8") } catch { return "" }
    },
  }
}

const CAMINHO_NO_REPO = /(?:^|[\s"'`(])((?:src|scripts|hooks|tests|agents)\/[A-Za-z0-9_.\/-]+\.(?:js|mjs|py|json))/g
const TESTE_CITADO = /((?:tests|hooks)\/[A-Za-z0-9_.\/-]+\.(?:test\.js|py))/g

const todos = (texto, rx) => [...new Set(String(texto || "").match(rx) || [])]

/**
 * Os caminhos do repo citados num texto. Usa o GRUPO da regex, nunca o match
 * inteiro: o match carrega junto o delimitador que precede o caminho (aspa,
 * parêntese, espaço), e comparar `"src/x.js` com `src/x.js` reprovaria por
 * defeito da régua, não do contrato.
 */
const caminhosCitados = (texto) => [
  ...new Set([...String(texto || "").matchAll(CAMINHO_NO_REPO)].map((m) => m[1])),
]

/** O caminho declarado no campo, sem a prosa que às vezes o acompanha. */
const caminhoDeclarado = (valor) => (String(valor || "").match(/^[A-Za-z0-9_.\/-]+/) || [""])[0]

/** O campo é SÓ um caminho, ou é prosa com um caminho dentro? */
const ehCaminhoPuro = (valor) => typeof valor === "string" && /^[A-Za-z0-9_.\/-]+$/.test(valor.trim())

/** O primeiro arquivo do repo citado no comando E2E — o entrypoint que ele roda. */
function entrypointDoE2e(comando) {
  const achados = caminhosCitados(comando)
  return achados.length ? achados[0] : null
}

/** O comando começa por um executor real? `runGovernedAction (...)` não começa. */
function comecaPorExecutor(comando) {
  const primeira = String(comando || "").trim().split(/\s+/)[0]
  return EXECUTORES.includes(primeira)
}

/** Os arquivos do repo citados no comando que NÃO existem. */
const arquivosAusentesDoE2e = (c, io) => caminhosCitados(c.e2eCommand).filter((p) => !io.has(p))

/** Os testes citados no controle negativo que NÃO existem. */
const testesAusentes = (c, io) => todos(c.negativeControl, TESTE_CITADO).filter((t) => !io.has(t))

/**
 * `path.join(root, "src", "x.js")` e `path.resolve(dirname, "..", "src", "x.js")`
 * — as duas formas que os testes deste repo usam para apontar um módulo.
 */
const CAMINHO_MONTADO = /(?:join|resolve)\(([^)]*"[^)]*\.(?:js|mjs|py|json)"[^)]*)\)/g
const SEGMENTO_CITADO = /"([^"]+)"/g

/**
 * Os arquivos do repo que um teste referencia — literalmente ou montados por
 * `path.join`. Ignorar a segunda forma reprovaria quase todo teste real deste
 * repo, que nunca escreve o caminho como string única.
 */
function referenciasDoTeste(corpo) {
  const refs = new Set(caminhosCitados(corpo))
  for (const m of String(corpo).matchAll(CAMINHO_MONTADO)) {
    // `".."` é navegação a partir do diretório do teste, não parte do caminho:
    // mantê-lo produziria `../src/x.js`, que nunca casa com o caminho do repo.
    const partes = [...m[1].matchAll(SEGMENTO_CITADO)].map((q) => q[1]).filter((q) => q !== "..")
    if (partes.length) refs.add(partes.join("/"))
  }
  return refs
}

/** O módulo referenciado importa o adaptador? — o salto único do caminho de chamada. */
function importaOAdaptador(refs, adapter, io) {
  const alvo = basename(adapter)
  return [...refs].some((r) => r !== adapter && io.has(r) && new RegExp(`from\\s+"[^"]*${alvo}"`).test(io.read(r)))
}

/**
 * O controle negativo TOCA a capacidade?
 *
 * Três ligações contam, e as três são reais:
 *  - o teste referencia o módulo adaptador;
 *  - o teste exercita o entrypoint do comando E2E (subprocesso — a capacidade é
 *    atingida através do comando, e exigir menção ao módulo reprovaria um E2E
 *    legítimo);
 *  - o teste exercita um módulo que IMPORTA o adaptador (um salto do caminho de
 *    chamada — `tests/task_run.test.js` roda `src/commands/task-run.js`, que
 *    importa `task-loop.js`; a capacidade é exercitada de verdade).
 *
 * O que NÃO conta é semelhança de nome: a ligação é sempre por arquivo.
 */
function ligaAoAdaptador(c, io) {
  const adapter = caminhoDeclarado(c.evidenceAdapter)
  const entrypoint = entrypointDoE2e(c.e2eCommand)
  const citados = todos(c.negativeControl, TESTE_CITADO).filter((t) => io.has(t))
  return citados.some((t) => {
    const refs = referenciasDoTeste(io.read(t))
    if (refs.has(adapter)) return true
    if (entrypoint && (refs.has(entrypoint) || refs.has(basename(entrypoint)))) return true
    return importaOAdaptador(refs, adapter, io)
  })
}

/**
 * As regras, como tabela. Cada `when` é uma pergunta com resposta em disco, e
 * cada `problem` diz o que faltou — o motivo por claim que o placar registra.
 */
export const REGRAS_DO_CONTRATO = Object.freeze([
  {
    id: "adapter_path",
    when: (c, io) => !ehCaminhoPuro(c.evidenceAdapter) || !io.has(caminhoDeclarado(c.evidenceAdapter)),
    problem: (c) => `evidenceAdapter não é caminho verificável: ${JSON.stringify(c.evidenceAdapter)}`,
  },
  {
    id: "e2e_executavel",
    when: (c) => !comecaPorExecutor(c.e2eCommand),
    problem: (c) => `e2eCommand não começa por executor real: ${JSON.stringify(c.e2eCommand)}`,
  },
  {
    id: "e2e_arquivos",
    when: (c, io) => arquivosAusentesDoE2e(c, io).length > 0,
    problem: (c, io) => `e2eCommand cita arquivo inexistente: ${arquivosAusentesDoE2e(c, io).join(", ")}`,
  },
  {
    id: "controle_negativo_existe",
    when: (c, io) => todos(c.negativeControl, TESTE_CITADO).filter((t) => io.has(t)).length === 0,
    problem: () => "negativeControl não cita nenhum teste existente",
  },
  {
    id: "controle_negativo_intacto",
    when: (c, io) => testesAusentes(c, io).length > 0,
    problem: (c, io) => `negativeControl cita teste inexistente: ${testesAusentes(c, io).join(", ")}`,
  },
  {
    id: "controle_negativo_liga",
    when: (c, io) => !ligaAoAdaptador(c, io),
    problem: () => "nenhum teste citado referencia o adaptador nem o entrypoint do E2E",
  },
  {
    id: "frescor_fechado",
    when: (c) => !FRESHNESS_BASIS.includes(c.freshness),
    problem: (c) => `freshness fora do vocabulário fechado: ${JSON.stringify(c.freshness)}`,
  },
])

/**
 * A árvore auditada é uma DISTRIBUIÇÃO, e não um repo-fonte?
 *
 * O `package.json` não distribui `tests/` — decisão antiga e correta. Mas as
 * regras 3 e 4 exigem que o arquivo do controle negativo EXISTA, e num pacote
 * instalado ele nunca existe. O resultado, medido: as 24 claims caíam para
 * NOT_PROVED no tarball enquanto eram REAL no repo, e o audit passava a dizer
 * ao usuário que nada no produto está provado.
 *
 * Isso é falso. Ausência por NÃO-ENVIO não é ausência de prova — a prova foi
 * feita no repo, no commit que gerou o pacote. Aplicar aqui uma regra que a
 * árvore não tem como satisfazer não é rigor: é medir a coisa errada e reportar
 * com confiança.
 *
 * A distinção é estrutural e não admite meio-termo: `tests/` inteiro ausente é
 * distribuição; `tests/` presente com UM arquivo faltando é defeito real, e
 * continua reprovando como antes.
 */
export const ehDistribuicao = (io = leitorPadrao()) => !io.has("tests")

/**
 * Os problemas de UM contrato contra o repo auditado. Lista vazia = tem dentes.
 *
 * `io` é injetável de propósito: o auditor roda tanto no repo-fonte quanto no
 * tarball instalado, e o contrato precisa ser verificado onde a auditoria está
 * acontecendo — não onde este arquivo mora.
 */
export function problemasDoContrato(contract, io = leitorPadrao()) {
  if (naoEhObjeto(contract)) return ["contrato ausente"]
  return problemas(contract, REGRAS_DO_CONTRATO.map((r) => ({
    when: (c) => r.when(c, io),
    problem: (c) => `[${r.id}] ${r.problem(c, io)}`,
  })))
}

/** O contrato sobrevive à verificação executável? */
export const contratoComDentes = (contract, io = leitorPadrao()) => problemasDoContrato(contract, io).length === 0
