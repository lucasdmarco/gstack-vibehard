import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "harness", "headroom.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("headroom: com uv usa `uv tool install` (isolado), NUNCA --system por padrão", async () => {
  const { installHeadroomPkg } = await imp()
  const calls = []
  const exec = (file, args) => { calls.push([file, ...args].join(" ")) } // sucesso na 1ª tentativa
  const ok = await installHeadroomPkg(() => {}, () => {}, "/usr/bin/uv", exec)
  assert.equal(ok, true)
  assert.ok(calls[0].includes("uv tool install"), "usa ambiente isolado")
  assert.ok(!calls.some((c) => c.includes("--system")), "nunca toca o Python do sistema por padrão")
})

test("headroom: sem uv usa pip --user (não --break-system-packages)", async () => {
  const prev = process.env.GSTACK_HEADROOM_SYSTEM
  delete process.env.GSTACK_HEADROOM_SYSTEM
  try {
    const { installHeadroomPkg } = await imp()
    const calls = []
    await installHeadroomPkg(() => {}, () => {}, "", (f, a) => calls.push([f, ...a].join(" ")))
    assert.ok(calls.some((c) => c.includes("pip install --user")), "instala no site do usuário")
    assert.ok(!calls.some((c) => c.includes("--break-system-packages") || c.includes("--system")))
  } finally { if (prev !== undefined) process.env.GSTACK_HEADROOM_SYSTEM = prev }
})

test("headroom: --system só com GSTACK_HEADROOM_SYSTEM=1 (opt-in explícito)", async () => {
  const prev = process.env.GSTACK_HEADROOM_SYSTEM
  process.env.GSTACK_HEADROOM_SYSTEM = "1"
  try {
    const { installHeadroomPkg } = await imp()
    const calls = []
    // todas as tentativas isoladas falham → cai no fallback --system (opt-in)
    await installHeadroomPkg(() => {}, () => {}, "/usr/bin/uv", (f, a) => {
      const c = [f, ...a].join(" "); calls.push(c)
      if (!c.includes("--system")) throw new Error("isolado falhou")
    })
    assert.ok(calls.some((c) => c.includes("pip install --system")), "fallback --system disponível só com opt-in")
  } finally {
    if (prev === undefined) delete process.env.GSTACK_HEADROOM_SYSTEM; else process.env.GSTACK_HEADROOM_SYSTEM = prev
  }
})
