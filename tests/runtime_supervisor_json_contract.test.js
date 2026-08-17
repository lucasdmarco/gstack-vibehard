import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"
import { evaluateJsonRun } from "./helpers/json-purity.js"

/**
 * CONSUMIDORES REAIS de `dev --json` e `stop --json`.
 *
 * São DOIS consumidores distintos e são provados separadamente: `dev` sobe
 * processo, `stop` encerra. Declarar um cobrindo o outro seria a mesma doença da
 * cobertura por nome de sink, um nível acima — e `runtime-supervisor.js` é
 * alcançado por quatro comandos, então a âncora é por COMANDO.
 *
 * ESTA PROVA CRIA E MATA PROCESSO DE VERDADE, e por isso o isolamento é parte do
 * contrato do teste, não cerimônia:
 *
 *   - workspace, HOME, USERPROFILE e TEMP descartáveis;
 *   - o serviço é um fixture conhecido (`node srv.mjs`) com MARCADOR de `runId`
 *     no nome e no argv;
 *   - o PID vem do state que o próprio `dev` grava DENTRO do sandbox — um
 *     processo preexistente da máquina não tem como estar num arquivo que não
 *     existia um segundo antes;
 *   - `stop` só pode reportar PIDs do cenário, e isso é asserção, não confiança;
 *   - `finally` mata qualquer sobrevivente PELO PID capturado, nunca por nome ou
 *     varredura;
 *   - limite de tempo rígido em todo subprocesso.
 *
 * NENHUM processo preexistente é observado, adotado ou encerrado: o teste não
 * enumera processos do sistema em momento algum.
 *
 * Falha de isolamento é `test_environment_invalid` — não é defeito do produto.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

const SERVIDOR = `import { createServer } from "http"
createServer((_q, r) => { r.end("ok") }).listen(Number(process.env.E2E_PORT || 0), "127.0.0.1")
`

/** Árvore de um diretório: relativo -> tamanho|mtime. */
function snapshot(raiz) {
  const saida = new Map()
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome)
      const st = statSync(p)
      if (st.isDirectory()) andar(p)
      else saida.set(path.relative(raiz, p), `${st.size}|${st.mtimeMs}`)
    }
  }
  andar(raiz)
  return saida
}

/** Ambiente descartável + workspace com um serviço fixture marcado por `runId`. */
function cenario(t) {
  const runId = `gstackproof-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const pidsCriados = []
  let raiz
  try {
    raiz = mkdtempSync(path.join(tmpdir(), "gstack-rts-"))
    mkdirSync(path.join(raiz, "home"), { recursive: true })
    mkdirSync(path.join(raiz, "tmp"), { recursive: true })
    mkdirSync(path.join(raiz, "ws", ".gstack"), { recursive: true })
    writeFileSync(path.join(raiz, "ws", "srv.mjs"), SERVIDOR)
    writeFileSync(path.join(raiz, "ws", ".gstack", "runtime.json"), JSON.stringify({
      schemaVersion: 2,
      services: [{
        name: `web-${runId}`,
        command: ["node", "srv.mjs", "--gstack-proof", runId],
        cwd: ".",
        port: { preferred: 6600 + Math.floor(Math.random() * 300), env: "E2E_PORT", autoAllocate: true },
        health: { readiness: { type: "http", path: "/", timeoutSeconds: 20 } },
      }],
    }, null, 2))
  } catch (e) {
    assert.fail(`test_environment_invalid: não consegui preparar o cenário (${e.code || e.message})`)
  }

  // SEMPRE, e só por PID capturado por este teste.
  t.after(() => {
    for (const pid of pidsCriados) {
      try { process.kill(pid, "SIGKILL") } catch { /* já morreu — é o esperado */ }
    }
    cleanupTmp(raiz)
  })

  const dentro = (d) => path.join(raiz, d)
  return {
    raiz, runId, pidsCriados,
    ws: dentro("ws"),
    env: {
      ...process.env,
      HOME: dentro("home"), USERPROFILE: dentro("home"),
      TMPDIR: dentro("tmp"), TEMP: dentro("tmp"), TMP: dentro("tmp"),
      NODE_DISABLE_COMPILE_CACHE: "1",
    },
  }
}

const rodar = (c, args) => evaluateJsonRun(spawnSync("node", [bin, ...args], {
  cwd: c.ws, env: c.env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000,
}))

function assertRodou(r, nome) {
  assert.equal(r.spawnFailed, false, `test_environment_invalid: spawn falhou em ${nome}`)
  assert.equal(r.timedOut, false, `test_environment_invalid: timeout em ${nome}`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execução inválida`)
}

function payloadDe(c, args, nome) {
  const r = rodar(c, args)
  assertRodou(r, nome)
  assert.equal(r.pure, true, `${nome}: stdout não é documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, `${nome}: payload de máquina não pode sair pelo stderr`)
  return r.doc
}

/** Sobe o serviço e REGISTRA o PID para o cleanup — sempre nesta ordem. */
function subirServico(c) {
  const p = payloadDe(c, ["dev", "--json"], "dev --json")
  for (const s of p.services ?? []) {
    if (Number.isInteger(s.pid) && s.pid > 0) c.pidsCriados.push(s.pid)
  }
  return p
}

const vivo = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

// ── Consumidor 1: `dev --json` ─────────────────────────────────────────────

test("`dev --json`: documento puro, com o serviço do cenário e PID próprio", (t) => {
  const c = cenario(t)
  const p = subirServico(c)

  assert.ok(Array.isArray(p.services) && p.services.length === 1, "o cenário declara UM serviço")
  const s = p.services[0]
  assert.equal(s.name, `web-${c.runId}`, "o nome carrega o marcador do cenário")
  assert.match(s.command, new RegExp(c.runId), "o argv do processo carrega o mesmo marcador — ownership provável")
  assert.ok(Number.isInteger(s.pid) && s.pid > 0, "o consumidor precisa do PID para supervisionar")
  assert.equal(s.status, "ready")
  assert.ok(Number.isInteger(s.port) && s.port > 0)
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\//, "a URL é local por construção")

  assert.ok(path.resolve(s.log).startsWith(path.resolve(c.raiz)),
    "test_environment_invalid: o log saiu do sandbox")
})

test("`dev --json`: o state em disco concorda com o payload", (t) => {
  const c = cenario(t)
  const s = subirServico(c).services[0]

  const arquivo = path.join(c.ws, ".gstack", "runtime", `${s.name}.json`)
  assert.ok(existsSync(arquivo), "o supervisor precisa persistir o state para `stop` e `logs` acharem")
  const state = JSON.parse(readFileSync(arquivo, "utf-8"))
  assert.equal(state.pid, s.pid, "payload e state precisam falar do MESMO processo")
  assert.equal(state.status, "ready")
})

// ── Consumidor 2: `stop --json` ────────────────────────────────────────────

/**
 * A ASSERÇÃO DE OWNERSHIP: `stop` só pode reportar PIDs deste cenário. O
 * conjunto de comparação vem do state que o próprio `dev` gravou no sandbox — e
 * não de uma varredura de processos da máquina, que é justamente o que não se
 * pode fazer.
 */
test("`stop --json`: encerra SOMENTE os PIDs do cenário, e reporta quais", (t) => {
  const c = cenario(t)
  const doCenario = new Set(subirServico(c).services.map((s) => s.pid))

  const p = payloadDe(c, ["stop", "--json"], "stop --json")
  assert.ok(Array.isArray(p.stopped) && p.stopped.length === 1)
  for (const s of p.stopped) {
    assert.ok(doCenario.has(s.pid), `stop reportou PID fora do cenário: ${s.pid}`)
    assert.equal(s.status, "stopped")
    assert.match(s.name, new RegExp(c.runId))
  }
  assert.deepEqual(p.stillAlive, [], "nada pode sobrar de pé")
  assert.equal(p.cleared, true, "o state é limpo — `stop` é idempotente a partir daqui")
  assert.equal(p.exitCode, 0)
})

test("EFEITO SEMÂNTICO: o processo do cenário está de fato morto depois do `stop`", (t) => {
  const c = cenario(t)
  const pid = subirServico(c).services[0].pid
  assert.equal(vivo(pid), true, "test_environment_invalid: o serviço não chegou a subir")

  payloadDe(c, ["stop", "--json"], "stop --json")
  assert.equal(vivo(pid), false, "`stop` precisa encerrar de verdade, não só reescrever o state")
})

test("`stop --json` sem nada rodando: documento vazio, não prosa", (t) => {
  const c = cenario(t)
  const p = payloadDe(c, ["stop", "--json"], "stop sem runtime")
  assert.deepEqual(p.stopped, [], "sem state, não há o que parar — e o consumidor recebe isso serializado")
})

// ── Isolamento e controles negativos ──────────────────────────────────────

test("ISOLAMENTO: nada é escrito fora do workspace do cenário", (t) => {
  const c = cenario(t)
  const antesHome = snapshot(path.join(c.raiz, "home"))

  subirServico(c)
  payloadDe(c, ["stop", "--json"], "stop --json")

  const depoisHome = snapshot(path.join(c.raiz, "home"))
  assert.deepEqual([...depoisHome.keys()], [...antesHome.keys()],
    "dev/stop não podem tocar o HOME — todo estado vive em `.gstack/` do projeto")
})

test("CONTROLE NEGATIVO: sem `--json`, `dev` e `stop` saem em prosa", (t) => {
  const c = cenario(t)

  const rd = rodar(c, ["dev"])
  assertRodou(rd, "dev sem --json")
  // O PID sai no relatório humano; capturo pelo state para garantir o cleanup.
  const dir = path.join(c.ws, ".gstack", "runtime")
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const st = JSON.parse(readFileSync(path.join(dir, f), "utf-8"))
      if (Number.isInteger(st.pid)) c.pidsCriados.push(st.pid)
    }
  }
  assert.equal(rd.pure, false, "no ramo humano o stdout não pode ser documento JSON puro")

  const rs = rodar(c, ["stop"])
  assertRodou(rs, "stop sem --json")
  assert.equal(rs.pure, false)
})
