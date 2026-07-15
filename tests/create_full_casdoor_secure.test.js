import test from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// PRD45 S45.0 (P0.4) — o docker-compose gerado para o Casdoor não pode nascer inseguro:
//  (1) imagem FIXADA POR DIGEST (nunca `:latest`, que é mutável e quebra reprodutibilidade);
//  (2) publicado SÓ em loopback (`127.0.0.1`) — nunca `0.0.0.0:8000`, que exporia a
//      credencial-padrão conhecida na rede local (o impacto central do P0.4).
// Controle negativo: reintroduzir `:latest` ou o bind público reprova.

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")

test("Casdoor compose: imagem por digest e bind só em loopback (nunca :latest / 0.0.0.0)", async () => {
  const { casdoorComposeYaml } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
  const yaml = casdoorComposeYaml()

  // Supply chain: imagem imutável por digest.
  assert.ok(!/casbin\/casdoor:latest/.test(yaml), "CONTROLE NEGATIVO: nunca `casbin/casdoor:latest` (mutável)")
  assert.match(yaml, /image:\s*casbin\/casdoor@sha256:[0-9a-f]{64}/, "imagem fixada por digest")

  // Rede: nunca publicar em 0.0.0.0 (exposição na rede local com credencial conhecida).
  assert.ok(!/^\s*-\s*"?8000:8000"?\s*$/m.test(yaml), "CONTROLE NEGATIVO: nunca `8000:8000` (0.0.0.0)")
  assert.match(yaml, /127\.0\.0\.1:\d+:8000/, "publica só em loopback 127.0.0.1")
})
