import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD51 S51.10.2 — controle negativo do consentimento de escrita global.
 *
 * A auditoria da matriz de RC (§51.10) encontrou o DoD "Full não modifica config global
 * sem consentimento, backup e restore" com DUAS pernas provadas e uma NÃO:
 *
 *   backup  — provado (`uninstall_restore.test.js`: `.gstack_vibehard.bak` real)
 *   restore — provado (mesmo arquivo: restaura ANTES de apagar o manifest)
 *   consentimento — o gate existia em `install.js` e o preflight de impacto era testado
 *                   (`install_impact.test.js`), mas nada provava a RECUSA.
 *
 * A recusa é justamente a perna que protege o usuário: um gate que só é exercitado no
 * caminho do "sim" não é um gate, é uma formalidade. Este arquivo prova os dois lados.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "installer", "install.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

/** Silencia a saída do gate (ele imprime orientação ao usuário). */
async function quiet(fn) {
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  process.stderr.write = (s) => { buf += String(s); return true }
  try { return { value: await fn(), out: buf } } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

/** Executa com stdin.isTTY forçado, restaurando o descritor original depois. */
async function withTTY(isTTY, fn) {
  const desc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
  Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true })
  try { return await fn() } finally {
    if (desc) Object.defineProperty(process.stdin, "isTTY", desc)
    else delete process.stdin.isTTY
  }
}

test("RECUSA: modo não-interativo SEM confirmação explícita não autoriza escrita global", async () => {
  const { confirmGlobalWrite } = await imp()
  const r = await withTTY(false, () => quiet(() => confirmGlobalWrite({ globalConfirmed: false })))
  assert.equal(r.value, false, "sem TTY e sem --yes, o install NÃO pode escrever no home")
})

test("RECUSA é acionável: diz exatamente quais formas de consentir existem", async () => {
  const { confirmGlobalWrite } = await imp()
  const r = await withTTY(false, () => quiet(() => confirmGlobalWrite({ globalConfirmed: false })))
  assert.match(r.out, /--yes/, "oferece a confirmação completa")
  assert.match(r.out, /--project-only/, "oferece o caminho de impacto mínimo")
  assert.match(r.out, /--audit-only/, "oferece inspecionar sem instalar")
})

test("AUTORIZA: consentimento explícito (--yes/--global ⇒ globalConfirmed) libera sem perguntar", async () => {
  const { confirmGlobalWrite } = await imp()
  const r = await withTTY(false, () => quiet(() => confirmGlobalWrite({ globalConfirmed: true })))
  assert.equal(r.value, true)
})

test("CONTROLE NEGATIVO do TTY: com terminal, 'não' do usuário bloqueia a instalação", async () => {
  const { confirmGlobalWrite } = await imp()
  const r = await withTTY(true, () => quiet(() => confirmGlobalWrite({ globalConfirmed: false }, { confirm: async () => false })))
  assert.equal(r.value, false, "usuário disse não — nada global é escrito")
  assert.match(r.out, /cancelada/i, "e o cancelamento é comunicado, não silencioso")
})

test("TTY com 'sim' autoriza — o gate não é um bloqueio cego, é uma pergunta de verdade", async () => {
  const { confirmGlobalWrite } = await imp()
  const r = await withTTY(true, () => quiet(() => confirmGlobalWrite({ globalConfirmed: false }, { confirm: async () => true })))
  assert.equal(r.value, true)
})

test("o default do prompt é NÃO — enter distraído nunca autoriza escrita global", async () => {
  const { confirmGlobalWrite } = await imp()
  let defaultRecebido
  await withTTY(true, () => quiet(() => confirmGlobalWrite({ globalConfirmed: false }, {
    confirm: async (_msg, def) => { defaultRecebido = def; return false },
  })))
  assert.equal(defaultRecebido, false, "o default precisa ser recusar, não aceitar")
})
