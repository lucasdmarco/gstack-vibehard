import test from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// PRD45 S45.1 — supervisor seguro e ownership de processo.
//   P0.2: `stop` convertia QUALQUER erro de kill em `already-gone` (perdia access_denied /
//         signal_failed) e apagava o state mesmo com PID ainda vivo — sem retry seguro.
//   P1.1: `isProcessOurs` falhava ABERTO (matava) quando o baseline não era verificável.
// Correção: estados de stop tipados; ausência de baseline verificável ⇒ `skipped_unverified`
// (fail-closed); idade ilegível ⇒ procede porém AUDITADO (`unverified_age`); state só é
// limpo quando comprovadamente encerrado.

const supMod = path.resolve(import.meta.dirname, "..", "src", "runtime", "supervisor.js")
const imp = () => import(`${pathToFileURL(supMod)}?t=${Date.now()}`)

test("ownership fail-closed: sem startedAt ou timestamp inválido ⇒ NÃO-nosso (não mata)", async () => {
  const { ownershipVerdict } = await imp()
  const now = Date.parse("2026-06-25T12:00:10Z")
  // (a) sem baseline e (b) timestamp inválido = adulteração óbvia ⇒ fail-closed.
  assert.equal(ownershipVerdict({}, 5, now).verified, false, "sem startedAt não é verificável")
  assert.equal(ownershipVerdict({}, 5, now).reason, "unverified_baseline")
  assert.equal(ownershipVerdict({ startedAt: "lixo-nao-data" }, 5, now).verified, false, "timestamp inválido")
})

test("ownership auditado: idade ILEGÍVEL procede (não é ataque) mas marca unverified_age", async () => {
  const { ownershipVerdict } = await imp()
  const now = Date.parse("2026-06-25T12:00:10Z")
  const v = ownershipVerdict({ startedAt: "2026-06-25T12:00:00Z" }, null, now)
  assert.equal(v.ours, true, "sem leitura de idade o stop legítimo procede (decisão de produto)")
  assert.equal(v.reason, "unverified_age", "mas fica AUDITADO, nunca silencioso")
})

test("ownership verificado: idade bate ⇒ nosso; idade absurda ⇒ pid reusado (foreign)", async () => {
  const { ownershipVerdict } = await imp()
  const now = Date.parse("2026-06-25T12:00:10Z")
  const ours = { startedAt: "2026-06-25T12:00:00Z" }
  assert.equal(ownershipVerdict(ours, 10, now).ours, true, "idade ~10s bate")
  assert.equal(ownershipVerdict(ours, 99999, now).ours, false, "CONTROLE NEGATIVO: muito mais velho = reusado")
})

test("compat: isProcessOurs mantém contrato booleano para chamadores existentes", async () => {
  const { isProcessOurs } = await imp()
  const now = Date.parse("2026-06-25T12:00:10Z")
  const ours = { startedAt: "2026-06-25T12:00:00Z" }
  assert.equal(isProcessOurs(ours, 10, now), true)
  assert.equal(isProcessOurs(ours, 99999, now), false)
  assert.equal(isProcessOurs(ours, null, now), true, "idade ilegível ainda procede (auditado no verdict)")
})

test("P0.2: erro de kill é TIPADO (não vira 'already-gone' cego)", async () => {
  const { stopAll } = await imp()
  const eperm = () => { throw Object.assign(new Error("operation not permitted"), { code: "EPERM" }) }
  const esrch = () => { throw Object.assign(new Error("no such process"), { code: "ESRCH" }) }
  const r = stopAll([{ name: "denied", pid: 100, startedAt: "2026-06-25T12:00:00Z" }], { kill: eperm, platform: "linux", getAgeSec: () => 10, now: Date.parse("2026-06-25T12:00:10Z") })
  assert.equal(r[0].status, "access_denied", "EPERM = acesso negado, NÃO 'already-gone'")
  const g = stopAll([{ name: "gone", pid: 101, startedAt: "2026-06-25T12:00:00Z" }], { kill: esrch, platform: "linux", getAgeSec: () => 10, now: Date.parse("2026-06-25T12:00:10Z") })
  assert.equal(g[0].status, "already_gone", "ESRCH = de fato sumiu (com underscore, status tipado)")
})

test("P1.1: pid não-verificável é PULADO como skipped_unverified, não morto", async () => {
  const { stopAll } = await imp()
  const killed = []
  const r = stopAll(
    [{ name: "tampered", pid: 100 }, { name: "ok", pid: 200, startedAt: "2026-06-25T12:00:00Z" }],
    { kill: (pid) => killed.push(pid), platform: "linux", getAgeSec: () => 10, now: Date.parse("2026-06-25T12:00:10Z") },
  )
  assert.equal(r.find((x) => x.name === "tampered").status, "skipped_unverified", "sem baseline = fail-closed")
  // POSIX mata o GRUPO: kill(-pid). Nem 100 nem -100 podem aparecer.
  assert.ok(!killed.includes(100) && !killed.includes(-100), "CONTROLE NEGATIVO: não mata o não-verificável")
  assert.ok(killed.includes(-200), "o verificável é morto (grupo -pid no POSIX)")
})

test("P1.1: pid reusado (idade divergente) segue pulado", async () => {
  const { stopAll } = await imp()
  const killed = []
  const r = stopAll(
    [{ name: "reused", pid: 200, startedAt: "2026-06-25T12:00:00Z" }],
    { kill: (pid) => killed.push(pid), platform: "linux", getAgeSec: () => 99999, now: Date.parse("2026-06-25T12:00:10Z") },
  )
  assert.equal(r[0].status, "skipped_foreign", "idade absurda = pid reusado")
  assert.ok(!killed.includes(200) && !killed.includes(-200), "não mata reusado (nem grupo)")
})

test("stopOutcome: só é limpável quando NENHUM pid ficou vivo/negado/não-verificado", async () => {
  const { stopOutcome } = await imp()
  const clean = stopOutcome([{ name: "a", status: "stopped", pid: 1 }, { name: "b", status: "already_gone", pid: 2 }], [])
  assert.equal(clean.clearable, true, "tudo encerrado ⇒ pode limpar state")
  assert.equal(clean.exitCode, 0)

  const alive = stopOutcome([{ name: "a", status: "stopped", pid: 1 }], [1])
  assert.equal(alive.clearable, false, "pid ainda vivo ⇒ NÃO apaga o state (retry seguro)")
  assert.notEqual(alive.exitCode, 0, "exit não-zero")

  const denied = stopOutcome([{ name: "a", status: "access_denied", pid: 1 }], [])
  assert.equal(denied.clearable, false, "acesso negado ⇒ preserva state")
  assert.notEqual(denied.exitCode, 0)

  const unver = stopOutcome([{ name: "a", status: "skipped_unverified", pid: 1 }], [])
  assert.equal(unver.clearable, false, "não-verificado ⇒ preserva (pode ser processo alheio OU state corrompido)")
})
