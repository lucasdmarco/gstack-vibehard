import test from "node:test"
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, openSync, closeSync, rmSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import net from "node:net"
import path from "node:path"
import { cleanupTmp } from "./helpers/tmp.js"
import { stopAllPhased } from "../src/runtime/supervisor.js"
import { isPortFree } from "../src/runtime/ports.js"

/**
 * PRD54 §2.1 (S54.2) — provas 3, 4 e 8, contra PROCESSO REAL.
 *
 * O §2.1 não pede opinião sobre o supervisor; pede efeito observável depois que
 * ele diz "parei". A auditoria reproduziu, no Windows, exatamente os três
 * sintomas que estes testes medem:
 *
 *   3. handles de stdout/stderr/log/cwd NÃO fechados → `EBUSY` ao remover o
 *      diretório do projeto logo depois do `stop`;
 *   4. porta permanecendo presa;
 *   8. processo residual sobrevivendo ao ciclo.
 *
 * POR QUE PROCESSO REAL E NÃO MOCK: os três são propriedades do SISTEMA
 * OPERACIONAL, não da nossa lógica. Um mock de `isAlive` prova que o código
 * classifica bem; ele não prova que o Windows soltou o handle do arquivo de log.
 * A lógica já tem cobertura farta em `runtime_supervisor.test.js` — o que
 * faltava era a metade que só o SO responde.
 *
 * O serviço de teste é deliberadamente HOSTIL às três provas: segura uma porta,
 * mantém o log aberto por herança de fd e tem o cwd dentro do diretório que a
 * prova vai tentar remover. Um serviço que não segurasse nada passaria nos três
 * sem dizer nada sobre o supervisor.
 */

const éWindows = process.platform === "win32"

const SERVICO = `
const net = require("net")
const porta = Number(process.argv[2])
const srv = net.createServer(() => {})
srv.listen(porta, "127.0.0.1", () => { process.stdout.write("ouvindo " + porta + "\\n") })
setInterval(() => {}, 1000)
`

const vivo = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === "EPERM" } }

/** Mata sem cerimônia — é limpeza de teste, não é o que está sendo medido. */
function matarSemDo(pid) {
  if (!pid || !vivo(pid)) return
  try {
    if (éWindows) execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
    else process.kill(-pid, "SIGKILL")
  } catch { /* já se foi */ }
}

/**
 * Uma porta que o SO acabou de dizer estar livre.
 *
 * `listen(0)` e nao varredura de faixa: a primeira versao varria a partir de
 * 45210 abrindo e fechando um servidor por tentativa, o que dava dezenas de
 * `listen/close` por ciclo e, em 20 ciclos, virava carga de I/O suficiente para
 * derrubar o probe de readiness de OUTRO teste rodando em paralelo
 * (`dev --json` voltou `unhealthy`). Um teste que quebra o vizinho mede o
 * agendador, nao o supervisor.
 */
function portaEfemera() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** Sobe o serviço hostil e espera ele ATENDER de fato na porta. */
async function subirServico(dir, porta) {
  const script = path.join(dir, "svc.cjs")
  writeFileSync(script, SERVICO)
  const cwd = path.join(dir, "projeto")
  mkdirSync(cwd, { recursive: true })
  const logPath = path.join(cwd, "web.log")
  const fd = openSync(logPath, "a")
  const child = spawn(process.execPath, [script, String(porta)], {
    cwd, stdio: ["ignore", fd, fd], detached: true, windowsHide: true,
  })
  child.unref()
  closeSync(fd) // o PAI solta; quem segura daqui em diante é o FILHO — que é o ponto
  await esperarPortaOcupada(porta)
  return { pid: child.pid, cwd, logPath }
}

async function esperarPortaOcupada(porta, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    if (!(await isPortFree(porta))) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`o serviço nunca ocupou a porta ${porta} — a prova mediria o vazio`)
}

const execReal = (file, args) => execFileSync(file, args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf-8" })

/**
 * O TETO DA LIBERAÇÃO, e por que ele existe.
 *
 * A primeira versão destas provas conferia porta e cwd UMA vez, imediatamente
 * depois de `stopAllPhased` retornar. Passou 19 de 20 ciclos e caiu no 15º
 * durante a suíte cheia, com porta presa E cwd em `EPERM` no mesmo ciclo, o pid
 * já morto.
 *
 * Fui medir em vez de chamar de flake. 30 ciclos ociosos e 30 sob contenção:
 *
 *   porta livre : p50 1ms, máx 3ms   — mas 0ms em apenas 6 de 30 ciclos
 *   cwd removível: p50 2ms, máx 4ms  — e NUNCA 0ms, em nenhum dos 60 ciclos
 *
 * Ou seja: o SO nunca solta os recursos de forma síncrona com a morte do
 * processo. Ele solta rápido. Uma asserção imediata afirmava sincronia — algo
 * que o Windows não oferece e nunca ofereceu —, e passava por sorte de
 * agendamento. O que o §2.1 pede ("liberação da porta", "fechamento de
 * handles") e o que um usuário precisa ("consigo reconstruir depois do stop")
 * são propriedades LIMITADAS, não instantâneas.
 *
 * 5s é folgado de propósito: 1000x o máximo medido. O teto não existe para ser
 * apertado, existe para distinguir "liberou" de "nunca libera" — que é a falha
 * real que o §2.1 descreve.
 */
const TETO_DE_LIBERACAO_MS = 5000

const espere = (ms) => new Promise((r) => setTimeout(r, ms))

/** Tenta até dar certo ou estourar o teto. Devolve o atraso observado, ou -1. */
async function atrasoAte(tentar, tetoMs = TETO_DE_LIBERACAO_MS) {
  const t0 = Date.now()
  while (Date.now() - t0 <= tetoMs) {
    if (await tentar()) return Date.now() - t0
    await espere(20)
  }
  return -1
}

/** O diretório saiu (dentro do teto)? Devolve o atraso, ou -1. */
const atrasoAteRemover = (dir) => atrasoAte(() => {
  try { rmSync(dir, { recursive: true, force: false }); return true } catch { return false }
})

/** Para de verdade, pela escada do produto. */
const pararPelaEscada = (pid) => stopAllPhased([{ name: "web", pid }], { exec: execReal, forceTimeoutMs: 8000 })

// ── A precondição: o serviço realmente segura o que a prova vai cobrar ──────

test("PRECONDIÇÃO: o serviço de teste segura porta, log e cwd", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-pre-"))
  let s = null
  try {
    const porta = await portaEfemera()
    s = await subirServico(dir, porta)
    assert.ok(vivo(s.pid), "sem processo vivo, as três provas passariam por vacuidade")
    assert.equal(await isPortFree(porta), false, "a porta precisa estar OCUPADA antes do stop")
    assert.ok(existsSync(s.logPath))

    // No Windows o cwd de um processo vivo é um handle: remover tem de FALHAR.
    // É esta falha que dá sentido à prova 3 — se removesse aqui, ela não mediria nada.
    let bloqueou = false
    try { rmSync(s.cwd, { recursive: true, force: false }) } catch { bloqueou = true }
    if (éWindows) assert.ok(bloqueou, "com o processo vivo, remover o cwd tinha de dar erro")
  } finally { matarSemDo(s && s.pid); cleanupTmp(dir) }
})

// ── PROVA 3: handles fechados ───────────────────────────────────────────────

/**
 * O `EBUSY` histórico. `taskkill` retorna ANTES de o SO encerrar o processo e
 * soltar os handles — por isso o `stop` espera a morte real em vez de confiar no
 * exit code. Esta prova cobra o efeito: depois que a escada diz que acabou, o
 * diretório do projeto tem de sair.
 */
test("PROVA 3: depois do stop, log e cwd são REMOVÍVEIS (sem EBUSY)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-handles-"))
  let s = null
  try {
    const porta = await portaEfemera()
    s = await subirServico(dir, porta)

    const r = await pararPelaEscada(s.pid)
    assert.deepEqual(r.stillAlive, [], "a prova de handle só vale se o processo morreu")

    const atraso = await atrasoAteRemover(s.cwd)
    assert.notEqual(atraso, -1, `cwd ainda preso após ${TETO_DE_LIBERACAO_MS}ms — é o EBUSY que o §2.1 nomeia`)
    assert.equal(existsSync(s.cwd), false, "o diretório do projeto precisa sair depois do stop")
    assert.equal(existsSync(s.logPath), false, "o log vive dentro do cwd e sai com ele")
  } finally { matarSemDo(s && s.pid); cleanupTmp(dir) }
})

// ── PROVA 4: porta liberada ─────────────────────────────────────────────────

test("PROVA 4: depois do stop, a porta volta a ser BINDÁVEL", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-porta-"))
  let s = null
  try {
    const porta = await portaEfemera()
    s = await subirServico(dir, porta)
    assert.equal(await isPortFree(porta), false)

    const r = await pararPelaEscada(s.pid)
    assert.deepEqual(r.stillAlive, [])

    // `isPortFree` abre e fecha um servidor de verdade — não consulta tabela.
    const atraso = await atrasoAte(() => isPortFree(porta))
    assert.notEqual(atraso, -1, `porta presa após ${TETO_DE_LIBERACAO_MS}ms — o sintoma que o §2.1 nomeia`)

    // E bindável de fato, não só "reportada livre": quem sobe depois precisa conseguir.
    await new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.once("error", reject)
      srv.listen(porta, "127.0.0.1", () => srv.close(resolve))
    })
  } finally { matarSemDo(s && s.pid); cleanupTmp(dir) }
})

// ── PROVA 8: ciclos repetidos sem residual ──────────────────────────────────

/**
 * O §2.1 pede 20x em "Windows normal, shell restrito e CI". Este teste cobre a
 * PRIMEIRA das três condições — a que esta máquina é. As outras duas não são
 * obteníveis daqui e continuam abertas; declará-las por analogia com esta seria
 * a afirmação que o §26.3 do PRD52 existe para impedir.
 *
 * O que 20 ciclos pegam que 1 não pega: vazamento incremental. Um handle que
 * escapa uma vez em vinte não aparece numa execução única, e é justamente o
 * padrão de "funciona na minha máquina, quebra no CI".
 */
test("PROVA 8 (parcial: Windows normal): 20 ciclos, zero residual", { timeout: 300000 }, async () => {
  const CICLOS = 20
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-20x-"))
  const residuais = []
  const escaladas = []
  try {
    for (let i = 0; i < CICLOS; i++) {
      const ciclo = path.join(dir, `c${i}`)
      mkdirSync(ciclo, { recursive: true })
      const porta = await portaEfemera()
      const s = await subirServico(ciclo, porta)

      const r = await pararPelaEscada(s.pid)
      escaladas.push(r.escalated.length)

      if (vivo(s.pid)) { residuais.push({ ciclo: i, pid: s.pid }); matarSemDo(s.pid) }
      if ((await atrasoAte(() => isPortFree(porta))) === -1) residuais.push({ ciclo: i, portaPresa: porta })
      // Remover o cwd é a prova 3 repetida: se um handle vazar num ciclo só,
      // é aqui que ele aparece.
      if ((await atrasoAteRemover(ciclo)) === -1) residuais.push({ ciclo: i, cwdNaoRemovido: true })
    }

    assert.deepEqual(residuais, [], `resíduo em ${residuais.length} de ${CICLOS} ciclos`)
    assert.deepEqual(escaladas, new Array(CICLOS).fill(0),
      "no Windows não há fase graciosa, então nada pode aparecer como ESCALADO")
  } finally { cleanupTmp(dir) }
})
