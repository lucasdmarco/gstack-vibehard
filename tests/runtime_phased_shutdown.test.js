import test from "node:test"
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, openSync, closeSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanupTmp } from "./helpers/tmp.js"
import { stopAllPhased, suportaGracioso, killTreeCommand } from "../src/runtime/supervisor.js"

/**
 * PRD54 §2.1 (S54.1) — provas 1 e 2: shutdown gracioso BOUNDED e encerramento da
 * árvore como FALLBACK.
 *
 * O §2.1 diz textualmente que `taskkill /T /F` isolado não satisfaz o contrato, e
 * era exatamente o que o Windows tinha: uma forma só, forçada, imediata.
 *
 * O QUE A MEDIÇÃO ACRESCENTOU AO PLANO. A primeira implementação pedia
 * gentilmente em toda plataforma e esperava 3s antes de forçar. No Windows isso
 * fez todo `stop` do e2e passar de 1,5s para 5,2s — e a razão, medida direto no
 * SO, é que o pedido é RECUSADO:
 *
 *   taskkill /PID 18276 /T
 *   ERRO: ... A finalização deste processo só pode ser forçada (com a opção /F)
 *
 * Não é "o serviço não atendeu". É o Windows recusando a forma gentil para
 * processo `detached` com console oculto — que é como o supervisor spawna. Um
 * prazo gasto esperando uma recusa conhecida é cerimônia cara, então a fase é
 * PULADA onde o SO não a oferece, e o recibo diz isso com todas as letras.
 */

const éWindows = process.platform === "win32"

/** Um serviço de verdade: fica vivo até alguém encerrá-lo. */
function servicoVivo(dir) {
  const script = path.join(dir, "svc.js")
  writeFileSync(script, 'setInterval(() => {}, 1000)\n')
  const fd = openSync(path.join(dir, "svc.log"), "a")
  const child = spawn(process.execPath, [script], {
    stdio: ["ignore", fd, fd], detached: true, windowsHide: true,
  })
  child.unref()
  closeSync(fd)
  return child.pid
}

const vivo = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === "EPERM" } }
const matar = (pid) => { try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* já morreu */ } }

// ── A escada, com exec injetado (roda em qualquer plataforma) ───────────────

/**
 * O pid sai de `taskkill /PID 123 /T` OU de `kill -TERM -123` — as duas formas
 * carregam o número de um jeito diferente, e ler só uma delas faria o fixture
 * mentir em silêncio (`NaN` nunca entra no conjunto de mortos, então o serviço
 * pareceria imortal e o teste culparia o produto).
 */
const pidDoComando = (args) => Number(String(args.find((a) => /^[-/]?\d+$/.test(a)) || "").replace(/^-/, ""))

/** Um `exec` que registra as chamadas e mata só quando vier `/F` (o Windows real). */
function execQueSóCedeÀForça(mortos) {
  return (file, args) => {
    if (args.includes("/F") || args.includes("-KILL")) { mortos.add(pidDoComando(args)); return }
    throw Object.assign(new Error("só pode ser forçada (com a opção /F)"), { stderr: "só pode ser forçada" })
  }
}

test("o fixture lê o pid das DUAS formas de comando", () => {
  assert.equal(pidDoComando(["/PID", "123", "/T", "/F"]), 123)
  assert.equal(pidDoComando(["-KILL", "-123"]), 123)
})

test("POSIX: pede primeiro, e quem não atende no prazo é forçado", async () => {
  const mortos = new Set()
  const chamadas = []
  const exec = (file, args) => { chamadas.push([file, ...args].join(" ")); execQueSóCedeÀForça(mortos)(file, args) }
  const r = await stopAllPhased([{ name: "web", pid: 111 }], {
    exec, platform: "linux",
    isAlive: (pid) => !mortos.has(pid),
    sleep: async () => {}, gracePeriodMs: 10, forceTimeoutMs: 10,
  })

  assert.deepEqual(chamadas, ["kill -TERM -111", "kill -KILL -111"], "a ordem é pedir e só então forçar")
  assert.equal(r.results[0].resolvedBy, "force")
  assert.deepEqual(r.escalated, [111])
  assert.deepEqual(r.stillAlive, [])
})

test("POSIX: quem atende o pedido NÃO chega a ser forçado", async () => {
  const chamadas = []
  const exec = (file, args) => chamadas.push([file, ...args].join(" "))
  const r = await stopAllPhased([{ name: "web", pid: 222 }], {
    exec, platform: "linux",
    isAlive: () => false, // atendeu o SIGTERM
    sleep: async () => {}, gracePeriodMs: 10,
  })

  assert.deepEqual(chamadas, ["kill -TERM -222"], "forçar quem já saiu limpo é violência sem motivo")
  assert.equal(r.results[0].resolvedBy, "graceful")
  assert.deepEqual(r.escalated, [])
})

/**
 * O `/F` só pode ver quem CONTINUA vivo. Entre as fases há um intervalo, e é
 * justamente aí que um pid liberado pode ser reciclado pelo SO — mandar kill
 * para quem já morreu é, no melhor caso, ruído, e no pior, matar processo alheio.
 */
test("a fase forçada só alcança quem sobreviveu ao pedido", async () => {
  const mortos = new Set([333])
  const chamadas = []
  const exec = (file, args) => { chamadas.push([file, ...args].join(" ")); execQueSóCedeÀForça(mortos)(file, args) }
  await stopAllPhased([{ name: "a", pid: 333 }, { name: "b", pid: 444 }], {
    exec, platform: "linux",
    isAlive: (pid) => !mortos.has(pid),
    sleep: async () => {}, gracePeriodMs: 10, forceTimeoutMs: 10,
  })

  assert.deepEqual(chamadas.filter((c) => c.includes("-KILL")), ["kill -KILL -444"],
    "o pid que já tinha saído não pode receber o golpe da segunda fase")
})

test("cada serviço aparece UMA vez — a linha forçada substitui a graciosa", async () => {
  const mortos = new Set()
  const r = await stopAllPhased([{ name: "web", pid: 555 }], {
    exec: execQueSóCedeÀForça(mortos), platform: "linux",
    isAlive: (pid) => !mortos.has(pid),
    sleep: async () => {}, gracePeriodMs: 10, forceTimeoutMs: 10,
  })
  assert.equal(r.results.length, 1, "duas linhas fariam o mesmo serviço contar como resolvido E pendente")
  assert.equal(r.results[0].resolvedBy, "force")
})

test("quem sobrevive às DUAS fases volta como stillAlive — nunca `stopped` otimista", async () => {
  const r = await stopAllPhased([{ name: "web", pid: 666 }], {
    exec: () => {}, platform: "linux",
    isAlive: () => true,
    sleep: async () => {}, gracePeriodMs: 10, forceTimeoutMs: 10,
  })
  assert.deepEqual(r.stillAlive, [666])
  assert.equal(r.results[0].status, "still_alive")
})

// ── Windows: a fase graciosa é pulada, e o recibo diz por quê ───────────────

test("Windows: sem fase graciosa, e a linha NOMEIA a ausência", async () => {
  const chamadas = []
  const r = await stopAllPhased([{ name: "web", pid: 777 }], {
    exec: (file, args) => chamadas.push([file, ...args].join(" ")),
    platform: "win32",
    isAlive: () => false,
    sleep: async () => {}, forceTimeoutMs: 10,
  })

  assert.deepEqual(chamadas, ["taskkill /PID 777 /T /F"], "nenhuma chamada gentil — o SO a recusa")
  assert.equal(r.results[0].resolvedBy, "force")
  assert.equal(r.results[0].gracefulSkipped, "unsupported_on_platform",
    "silêncio aqui faria parecer que houve pedido e ele falhou")
  assert.deepEqual(r.escalated, [], "não houve escalada: não houve primeira fase")
})

test("`suportaGracioso` é por plataforma, e o Windows é o único de fora", () => {
  assert.equal(suportaGracioso("linux"), true)
  assert.equal(suportaGracioso("darwin"), true)
  assert.equal(suportaGracioso("win32"), false)
})

/**
 * A MEDIÇÃO, executada e não citada. Este teste é a razão de `suportaGracioso`
 * existir: ele prova, contra o SO real, que a forma gentil é recusada para o
 * tipo de processo que o supervisor spawna. Se algum dia o Windows passar a
 * aceitá-la (ou o supervisor passar a spawnar de outro jeito), este teste falha
 * e a decisão volta para a mesa — que é o comportamento certo.
 */
test("REAL (Windows): o SO RECUSA o encerramento gentil de processo detached", { skip: !éWindows }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-graceful-"))
  let pid = null
  try {
    pid = servicoVivo(dir)
    assert.ok(vivo(pid), "o serviço precisa estar de pé para a medição valer")

    const { file, args } = killTreeCommand(pid, "win32")
    assert.equal(args.includes("/F"), false, "esta é a forma gentil")

    let recusa = null
    try { execFileSync(file, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }) }
    catch (e) { recusa = String(e.stderr || e.message) }

    assert.ok(recusa, "o pedido gentil precisa ter sido REJEITADO — se passou, `suportaGracioso` está errado")
    assert.match(recusa, /\/F|for(ç|c)ad/i, "a recusa do SO é explícita sobre exigir /F")
    assert.ok(vivo(pid), "e o processo continua de pé depois do pedido")
  } finally {
    if (pid) matar(pid)
    cleanupTmp(dir)
  }
})

/** PROVA 2, contra processo REAL: a árvore forçada encerra o que o pedido não encerrou. */
test("REAL (Windows): a fase forçada encerra o que o gentil não encerrou", { skip: !éWindows }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-forced-"))
  let pid = null
  try {
    pid = servicoVivo(dir)
    assert.ok(vivo(pid))

    const r = await stopAllPhased([{ name: "svc", pid }], {
      exec: (file, args) => execFileSync(file, args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf-8" }),
      forceTimeoutMs: 8000,
    })

    assert.deepEqual(r.stillAlive, [], "o §2.1 exige encerramento VERIFICÁVEL, não tentado")
    assert.equal(r.results[0].resolvedBy, "force")
    assert.equal(vivo(pid), false, "a autoridade é o processo em disco, não o exit code do taskkill")
  } finally {
    if (pid) matar(pid)
    cleanupTmp(dir)
  }
})
