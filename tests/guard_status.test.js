import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("interceptionMatrix: honesta — cursor/instrucionais NUNCA prometem pré-render", async () => {
  const { interceptionMatrix } = await imp("src/security/guard-status.js")
  const m = interceptionMatrix()
  const cursor = m.find((x) => x.harness === "cursor")
  assert.equal(cursor.preRender, false)
  assert.equal(cursor.interception, "none")
  const instr = m.find((x) => x.harness.includes("instrucionais"))
  assert.equal(instr.preRender, false)
  // quem TEM caminho real declara o COMO (env/config), nunca promessa vaga
  for (const x of m.filter((y) => y.preRender)) assert.ok(x.how.length > 5, `${x.harness} declara o como`)
})

test("probeProxy: conexão recusada = morto; resposta = vivo (fetch injetado)", async () => {
  const { probeProxy } = await imp("src/security/guard-status.js")
  assert.equal(await probeProxy(8788, { fetchImpl: async () => ({ status: 404 }) }), true, "qualquer resposta = ouvindo")
  assert.equal(await probeProxy(8788, { fetchImpl: async () => { throw Object.assign(new Error("ECONNREFUSED"), { name: "TypeError" }) } }), false)
})

test("buildGuardStatus: sem proxy → posthoc_only (default honesto)", async () => {
  const { buildGuardStatus } = await imp("src/security/guard-status.js")
  const st = await buildGuardStatus({ probe: Promise.resolve(false), env: {} })
  assert.equal(st.coverage, "posthoc_only")
  assert.equal(st.posthoc.active, true, "auditoria pós-resposta é sempre ativa")
  assert.equal(st.preRender.proxyRunning, false)
})

test("buildGuardStatus: proxy vivo MAS env não aponta → ainda posthoc_only (sem claim falso)", async () => {
  const { buildGuardStatus } = await imp("src/security/guard-status.js")
  const st = await buildGuardStatus({ probe: Promise.resolve(true), env: {} })
  assert.equal(st.coverage, "posthoc_only", "proxy rodando sem harness apontado NÃO é cobertura")
})

test("buildGuardStatus: proxy vivo + env apontando → pre_render_partial (nunca 'total')", async () => {
  const { buildGuardStatus } = await imp("src/security/guard-status.js")
  const st = await buildGuardStatus({
    probe: Promise.resolve(true),
    env: { ANTHROPIC_BASE_URL: "http://localhost:8788" },
  })
  assert.equal(st.coverage, "pre_render_partial")
  assert.equal(st.preRender.envPointing.anthropic, true)
  assert.equal(st.preRender.envPointing.openai, false)
})

test("proxy status --json: JSON puro com matriz e cobertura", async () => {
  const { proxyCommand } = await imp("src/commands/proxy.js")
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  let out
  try {
    out = await proxyCommand(["status", "--json"], { probe: Promise.resolve(false), env: {} })
  } finally { process.stdout.write = orig }
  const parsed = JSON.parse(buf.trim())
  assert.equal(parsed.coverage, "posthoc_only")
  assert.ok(Array.isArray(parsed.matrix) && parsed.matrix.length >= 4)
  assert.equal(out.coverage, "posthoc_only")
})
