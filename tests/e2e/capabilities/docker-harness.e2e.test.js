import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { dockerAvailable, classifyE2E } from "../../../src/capabilities/e2e-runner.js"

// PRD42 S42.0D — smoke REAL do harness de E2E de backend: prova que a suíte de capacidade
// EXERCITA um container de verdade (não finge), com imagem fixada e teardown. Docker-gated:
// sem engine, o contrato é blocked_missing_engine (NUNCA skip-verde falso) — o probe real
// roda em CI (.github/workflows/capability-e2e.yml).

const IMAGE = "alpine@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1" // alpine:3.20 pinado por digest
const dockerUp = dockerAvailable(() => { execFileSync("docker", ["info"], { stdio: "ignore", timeout: 15000 }); return true })

test("harness de capability exercita um container real (imagem pinada + teardown)", async (t) => {
  // Só roda no contexto DEDICADO (npm run test:e2e:capabilities / workflow) — não acopla
  // Docker/rede ao suite principal, mesmo em runners que têm Docker.
  if (process.env.GSTACK_CAP_E2E !== "1") { t.skip("fora do contexto capability-e2e (rode: npm run test:e2e:capabilities)"); return }
  if (!dockerUp) {
    const r = classifyE2E({ capability: "docker-harness", dockerUp: false })
    assert.equal(r.status, "blocked_missing_engine", "sem engine = blocked, nunca skip-verde")
    t.skip("Docker daemon ausente — probe real roda em CI (capability-e2e.yml)")
    return
  }
  const name = `gstack-e2e-${Date.now().toString(36)}`
  try {
    const out = execFileSync("docker", ["run", "--rm", "--name", name, IMAGE, "echo", "gstack-ok"], { encoding: "utf8", timeout: 60000 })
    const r = classifyE2E({ capability: "docker-harness", dockerUp: true, result: { ok: out.includes("gstack-ok") } })
    assert.equal(r.status, "passed", "container executou e retornou a sentinela")
  } finally {
    try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }) } catch { /* teardown best-effort */ }
  }
})
