import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "runtime-supervisor.js")

// Servidor http mínimo: prova que o supervisor sobe um processo REAL, sem shell,
// que SOBREVIVE ao `dev` (detached) e é morto pelo `stop` (árvore por plataforma).
const SERVER = `import http from "http"
const port = process.env.E2E_PORT || 6010
http.createServer((req, res) => { res.writeHead(200); res.end("ok") }).listen(port, "127.0.0.1", () => console.log("up " + port))
`

async function tryFetch(url, ms = 1500) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { const r = await fetch(url, { signal: ctrl.signal }); return r.status } catch { return null } finally { clearTimeout(t) }
}

test("e2e: dev sobe um serviço real (sobrevive ao launcher) e stop o mata", async () => {
  const { devCommand, stopCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-e2e-"))
  const port = 6010 + Math.floor(Math.random() * 500)
  try {
    await writeFile(path.join(dir, "server.mjs"), SERVER)
    await mkdir(path.join(dir, ".gstack"), { recursive: true })
    await writeFile(path.join(dir, ".gstack", "runtime.json"), JSON.stringify({
      schemaVersion: 2,
      services: [{
        name: "web",
        command: ["node", "server.mjs"],
        cwd: ".",
        port: { preferred: port, env: "E2E_PORT", autoAllocate: true },
        health: { readiness: { type: "http", path: "/", timeoutSeconds: 15 } },
      }],
    }, null, 2))

    await devCommand(["--json"], { cwd: dir })

    // a porta é ALOCADA pelo supervisor (preferred pode estar ocupada no CI) — leio
    // a porta/status REAIS do state file, nunca assumo a preferred.
    const state = JSON.parse(await readFile(path.join(dir, ".gstack", "runtime", "web.json"), "utf-8"))
    assert.equal(state.status, "ready", `dev marcou o serviço ready (status=${state.status})`)
    const realPort = state.port
    assert.ok(realPort >= port, "porta alocada a partir da preferred")

    // o serviço deve continuar de pé DEPOIS do dev retornar (prova do detached)
    let status = null
    for (let i = 0; i < 20 && status === null; i++) {
      status = await tryFetch(`http://127.0.0.1:${realPort}/`)
      if (status === null) await new Promise((r) => setTimeout(r, 250))
    }
    assert.equal(status, 200, "serviço respondendo após o dev sair (sobreviveu ao launcher)")

    stopCommand([], { cwd: dir })

    // após o stop a porta deve cair
    let down = false
    for (let i = 0; i < 20 && !down; i++) {
      const s = await tryFetch(`http://127.0.0.1:${realPort}/`, 800)
      if (s === null) down = true
      else await new Promise((r) => setTimeout(r, 250))
    }
    assert.equal(down, true, "porta liberada após o stop (árvore morta)")
  } finally {
    try { stopCommand([], { cwd: dir }) } catch { /* idempotente */ }
    await rm(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})
