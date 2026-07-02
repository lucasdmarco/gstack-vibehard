import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const SENSITIVE_IDS = ["twitter", "reddit", "facebook", "instagram", "xiaohongshu"]
const execNoBackend = () => { throw new Error("ENOENT") } // backend agent-reach ausente

async function mkProject() {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-reach-"))
  await mkdir(path.join(dir, ".gstack"), { recursive: true })
  return dir
}

async function run(args, opts = {}) {
  const { agentReachCommand } = await imp("src/commands/agent-reach.js")
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  let out
  try { out = await agentReachCommand(args, { exec: execNoBackend, ...opts }) } finally { process.stdout.write = orig }
  return { out, buf }
}

test("catálogo: core é SÓ zero-config; sensíveis exigem cookie/login", async () => {
  const { coreChannels, isSensitive, getChannel } = await imp("src/tools/agent-reach/catalog.js")
  const core = coreChannels()
  assert.ok(core.length >= 4)
  assert.ok(core.every((c) => c.zeroConfig && !isSensitive(c)), "core nunca tem canal sensível")
  for (const id of SENSITIVE_IDS) assert.ok(isSensitive(getChannel(id)), `${id} é sensível`)
})

test("enable não-interativo SEM flags → needs_channel_selection (aceite PRD)", async () => {
  const dir = await mkProject()
  try {
    const { out } = await run(["enable", "--json"], { cwd: dir })
    assert.equal(out.error, "needs_channel_selection")
    assert.match(out.hint, /--core|--channels/)
    assert.ok(!existsSync(path.join(dir, ".gstack", "integrations.json")) ||
      !(await readFile(path.join(dir, ".gstack", "integrations.json"), "utf-8")).includes("agentReach"), "nada registrado")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("enable --core: registra SÓ zero-config — nenhum canal cookie/login (aceite PRD)", async () => {
  const dir = await mkProject()
  try {
    const { out } = await run(["enable", "--core", "--json"], { cwd: dir })
    assert.equal(out.enabled, true)
    assert.equal(out.mode, "core")
    for (const id of SENSITIVE_IDS) assert.ok(!out.channels.includes(id), `${id} NUNCA entra no core`)
    const reg = JSON.parse(await readFile(path.join(dir, ".gstack", "integrations.json"), "utf-8"))
    assert.deepEqual(reg.agentReach.channels, out.channels)
    // backend ausente = declarado, nunca OK falso
    assert.equal(out.backend, "external_engine_unavailable")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("enable --dry-run --json: canais, riscos, writes, rollback e consentimento — SEM escrita", async () => {
  const dir = await mkProject()
  try {
    const { out } = await run(["enable", "--channels", "web-reader,twitter", "--accept-risks", "--dry-run", "--json"], { cwd: dir })
    assert.equal(out.dryRun, true)
    const tw = out.plan.channels.find((c) => c.id === "twitter")
    assert.equal(tw.sensitive, true)
    assert.equal(tw.consentRequired, true)
    assert.ok(out.plan.risks.some((r) => r.startsWith("twitter:")))
    assert.deepEqual(out.plan.writes, [".gstack/integrations.json"])
    assert.match(out.plan.rollback, /integrations\.json/)
    const regFile = path.join(dir, ".gstack", "integrations.json")
    assert.ok(!existsSync(regFile), "dry-run não escreveu nada")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("canal sensível em modo não-interativo exige --accept-risks", async () => {
  const dir = await mkProject()
  try {
    const denied = await run(["enable", "--channels", "twitter", "--json"], { cwd: dir })
    assert.equal(denied.out.error, "needs_accept_risks")
    assert.deepEqual(denied.out.sensitiveChannels, ["twitter"])

    const ok = await run(["enable", "--channels", "twitter", "--accept-risks", "--json"], { cwd: dir })
    assert.equal(ok.out.enabled, true)
    const reg = JSON.parse(await readFile(path.join(dir, ".gstack", "integrations.json"), "utf-8"))
    assert.ok(reg.agentReach.consented.twitter, "consentimento registrado com timestamp")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("--channels all sem --accept-risks → recusa listando os canais sensíveis", async () => {
  const dir = await mkProject()
  try {
    const { out } = await run(["enable", "--channels", "all", "--json"], { cwd: dir })
    assert.equal(out.error, "needs_accept_risks")
    for (const id of SENSITIVE_IDS) assert.ok(out.sensitiveChannels.includes(id), `efeito listado: ${id}`)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("enable --safe: só plano/orientação — sem dependências nem writes", async () => {
  const dir = await mkProject()
  try {
    const { out } = await run(["enable", "--core", "--safe", "--json"], { cwd: dir })
    assert.equal(out.safe, true)
    assert.deepEqual(out.plan.dependencies, [])
    assert.deepEqual(out.plan.writes, [])
    assert.ok(!existsSync(path.join(dir, ".gstack", "integrations.json")))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("doctor --json: backend ausente = external_engine_unavailable + active_backend null", async () => {
  const dir = await mkProject()
  try {
    await run(["enable", "--core", "--json"], { cwd: dir })
    const { out } = await run(["doctor", "--json"], { cwd: dir })
    assert.equal(out.backend, "external_engine_unavailable")
    const web = out.channels.find((c) => c.channel === "web-reader")
    assert.equal(web.enabled, true)
    assert.equal(web.status, "backend_missing")
    assert.equal(web.active_backend, null, "nunca finge backend ativo")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("doctor --json com backend PRESENTE: active_backend por canal habilitado", async () => {
  const dir = await mkProject()
  try {
    const execBackend = (file) => { if (file === "agent-reach") return "1.0.0"; throw new Error("ENOENT") }
    await run(["enable", "--core", "--json"], { cwd: dir, exec: execBackend })
    const { out } = await run(["doctor", "--json"], { cwd: dir, exec: execBackend })
    assert.equal(out.backend, "available")
    const web = out.channels.find((c) => c.channel === "web-reader")
    assert.equal(web.status, "configured")
    assert.equal(web.active_backend, "agent-reach")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("install-channel: canal desconhecido erra honesto; conhecido roteia pro enable", async () => {
  const dir = await mkProject()
  try {
    const bad = await run(["install-channel", "nao-existe", "--json"], { cwd: dir })
    assert.equal(bad.out.error, "unknown_channel")
    const ok = await run(["install-channel", "youtube", "--json"], { cwd: dir })
    assert.equal(ok.out.enabled, true)
    assert.deepEqual(ok.out.channels, ["youtube"])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
