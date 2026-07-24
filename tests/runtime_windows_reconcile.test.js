import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.1.1 — runtime Windows cross-harness: as DUAS causas que a v5.59.0 (S51.1)
 * NÃO fechou, reproduzidas pelo usuário (2/4 fail: 81s, PIDs vivos, EBUSY, dirs residuais).
 *
 * P0a — o diagnóstico do kill depende do stderr do taskkill. O chamador usava
 *   `stdio:"ignore"`, que DESCARTA o stderr → `isAccessDeniedError` cegava →
 *   access_denied virava signal_failed (state preso).
 *
 * P0b — `stopOutcome` filtrava `unresolved` sobre o status carimbado na probe
 *   IMEDIATA do kill, sem reconciliar contra o resultado da espera final
 *   (`waitPidsExit`). Um processo que morre DURANTE a espera (taskkill /F é
 *   assíncrono no Windows) mantinha `still_alive` → state nunca limpo → EBUSY.
 */

// ---------- P0b: reconciliação pós-espera ----------

test("CONTROLE NEGATIVO (o bug P0b): still_alive cujo pid MORREU na espera final -> state deve limpar", async () => {
  const { stopOutcome } = await imp("src/runtime/supervisor.js")
  // probe imediata carimbou still_alive; waitPidsExit depois confirmou que nada ficou vivo ([]).
  const r = stopOutcome([{ name: "web", status: "still_alive", pid: 1 }], [])
  assert.equal(r.clearable, true, "pid morreu durante a espera -> não é mais pendente -> state limpável")
  assert.equal(r.unresolved.length, 0, "nada não-resolvido quando a liveness real diz que morreu")
})

test("still_alive que CONTINUA vivo após a espera permanece não-resolvido (sem otimismo)", async () => {
  const { stopOutcome } = await imp("src/runtime/supervisor.js")
  const r = stopOutcome([{ name: "web", status: "still_alive", pid: 1 }], [1])
  assert.equal(r.clearable, false, "pid ainda vivo pós-espera -> nunca limpar")
})

test("access_denied NÃO é a race: preserva o state mesmo com o pid fora do stillAlive (decisão PRD45 S45.1)", async () => {
  const { stopOutcome } = await imp("src/runtime/supervisor.js")
  // access_denied é anomalia de PERMISSÃO, não a race do taskkill assíncrono. Fail-closed:
  // preserva o state para o retry/surface, mesmo que o pid tenha morrido sozinho depois.
  const r = stopOutcome([{ name: "web", status: "access_denied", pid: 7 }], [])
  assert.equal(r.clearable, false, "negado ⇒ preserva state (não reconciliar — não regride o PRD45)")
})

test("access_denied com pid AINDA vivo pós-espera continua bloqueando (segurança preservada)", async () => {
  const { stopOutcome } = await imp("src/runtime/supervisor.js")
  const r = stopOutcome([{ name: "web", status: "access_denied", pid: 7 }], [7])
  assert.equal(r.clearable, false, "negado E vivo -> não limpa, reporta")
})

test("ownership-skip (foreign) permanece não-resolvido mesmo com o pid fora do stillAlive", async () => {
  const { stopOutcome } = await imp("src/runtime/supervisor.js")
  // skipped_foreign é decisão de OWNERSHIP (não tocamos de propósito) — não é liveness nossa.
  const r = stopOutcome([{ name: "web", status: "skipped_foreign", pid: 42 }], [])
  assert.equal(r.clearable, false, "pid alheio nunca autoriza limpar o state — exige investigação")
})

test("a reconciliação preserva o status ORIGINAL para diagnóstico honesto", async () => {
  const { stopOutcome } = await imp("src/runtime/supervisor.js")
  const r = stopOutcome([{ name: "web", status: "still_alive", pid: 1 }], [])
  const web = (r.results || []).find((x) => x.name === "web")
  assert.ok(web, "outcome expõe os results reconciliados")
  assert.equal(web.status, "stopped", "status reconciliado para o render")
  assert.equal(web.reconciledFrom, "still_alive", "mantém de onde veio (não apaga o histórico)")
})

// ---------- P0a: o stderr do taskkill não pode ser descartado ----------

test("CONTROLE NEGATIVO (o bug P0a): o exec de kill do Windows CAPTURA o stderr (não usa stdio:ignore)", async () => {
  const { winKillExec } = await imp("src/commands/runtime-supervisor.js")
  let capturedOpts = null
  const fakeExecFileSync = (_file, _args, opts) => {
    capturedOpts = opts
    // taskkill negado escreve no stderr; só chega ao erro se o stdio o capturar (pipe).
    const chegou = opts && Array.isArray(opts.stdio) && opts.stdio[2] === "pipe"
    throw Object.assign(new Error("Command failed"), {
      status: 1, stderr: chegou ? "ERRO: acesso negado." : null,
    })
  }
  const exec = winKillExec(fakeExecFileSync)
  let err = null
  try { exec("taskkill", ["/PID", "1", "/T", "/F"]) } catch (e) { err = e }
  assert.ok(capturedOpts, "o exec chamou o execFileSync")
  assert.equal(capturedOpts.stdio[2], "pipe", "stderr DEVE ser capturado (pipe), nunca 'ignore'")
  assert.match(String(err.stderr), /acesso negado/i, "o stderr real chega ao classificador")
})

test("o stderr capturado faz access_denied ser detectado (ponta-a-ponta com o classificador)", async () => {
  const { winKillExec } = await imp("src/commands/runtime-supervisor.js")
  const { classifyKillResult } = await imp("src/runtime/supervisor.js")
  const fakeExecFileSync = (_f, _a, opts) => {
    throw Object.assign(new Error("Command failed"), {
      status: 1, stderr: opts.stdio[2] === "pipe" ? "ERRO: acesso negado." : null,
    })
  }
  const exec = winKillExec(fakeExecFileSync)
  let error = null
  try { exec("taskkill", ["/PID", "1", "/T", "/F"]) } catch (e) { error = e }
  // processo AINDA vivo após o kill negado:
  assert.equal(classifyKillResult({ error, aliveAfter: true }), "access_denied",
    "com o stderr preservado, o kill negado é access_denied — não signal_failed")
})
