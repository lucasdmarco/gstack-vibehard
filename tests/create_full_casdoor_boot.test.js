import test from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// PRD45 S45.0 (P0.5) — o Casdoor do Full NUNCA subia: crash-loop infinito com
// `panic: dial tcp [::1]:3306` (MySQL). Causa raiz provada com Docker real:
//   (1) as envs `driver`/`dataSource` do compose NÃO EXISTEM para o Casdoor — ele lê
//       `driverName`/`dataSourceName` de /conf/app.conf, cujo default é MySQL literal;
//   (2) o driver sqlite embutido é `modernc.org/sqlite`, registrado como `sqlite` —
//       com `sqlite3` o adapter do Casbin morre em `unknown driver "sqlite3"`
//       (só o ormer normaliza sqlite3→sqlite; o authz passa o nome cru);
//   (3) o volume precisa cair num dir que JÁ EXISTE na imagem com dono uid1000
//       (/home/casdoor) — em /var/lib/casdoor o volume nasce root e dá CANTOPEN(14).
// Receita validada end-to-end: HTTP 200 + login admin/123 -> "built-in/admin".
// Controle negativo: voltar a `sqlite3`, ao /var/lib/casdoor ou às envs falsas reprova.

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")
const imp = () => import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)

test("Casdoor app.conf: driver `sqlite` (modernc), nunca `sqlite3`/`mysql`", async () => {
  const { casdoorAppConf } = await imp()
  const conf = casdoorAppConf()

  // CONTROLE NEGATIVO: `sqlite3` quebra o adapter do Casbin (unknown driver).
  assert.ok(!/^driverName\s*=\s*sqlite3\s*$/m.test(conf), "CONTROLE NEGATIVO: `sqlite3` mata o authz do Casbin")
  assert.ok(!/^driverName\s*=\s*mysql\s*$/m.test(conf), "CONTROLE NEGATIVO: `mysql` = crash-loop dial tcp :3306")
  assert.match(conf, /^driverName\s*=\s*sqlite\s*$/m, "driver registrado por modernc.org/sqlite é `sqlite`")

  // O DB tem que morar no dir que já existe na imagem com dono uid1000.
  assert.ok(!/dataSourceName\s*=.*\/var\/lib\/casdoor/.test(conf), "CONTROLE NEGATIVO: /var/lib/casdoor => volume root => CANTOPEN(14)")
  assert.match(conf, /^dataSourceName\s*=\s*file:\/home\/casdoor\/casdoor\.db/m, "DB em /home/casdoor (uid1000)")

  // Chaves que o Casdoor exige para bootar (o conf é o da imagem, com 2 linhas trocadas).
  assert.match(conf, /^httpport\s*=\s*8000\s*$/m)
  assert.match(conf, /^dbName\s*=\s*casdoor\s*$/m)
  assert.ok(!conf.includes("\r"), "LF puro — CRLF quebra o parser do Beego no container Linux")
})

test("Casdoor compose: monta o app.conf e o volume em /home/casdoor; sem envs fantasma", async () => {
  const { casdoorComposeYaml, CASDOOR_APP_CONF_FILE } = await imp()
  const yaml = casdoorComposeYaml("casdoor-demo")

  // CONTROLE NEGATIVO: as envs que nunca funcionaram não podem voltar.
  assert.ok(!/^\s*driver:\s*/m.test(yaml), "CONTROLE NEGATIVO: env `driver` é ignorada pelo Casdoor")
  assert.ok(!/^\s*dataSource:\s*/m.test(yaml), "CONTROLE NEGATIVO: env `dataSource` é ignorada pelo Casdoor")

  // O conf real precisa ser montado read-only por cima do default da imagem.
  assert.ok(yaml.includes(`./${CASDOOR_APP_CONF_FILE}:/conf/app.conf:ro`), "monta o app.conf real em /conf/app.conf:ro")
  assert.ok(!/:\/var\/lib\/casdoor/.test(yaml), "CONTROLE NEGATIVO: volume em /var/lib/casdoor nasce root")
  assert.match(yaml, /:\/home\/casdoor\s*$/m, "volume de dados em /home/casdoor")

  // Preservado do P0.4: digest + loopback + container por projeto.
  assert.match(yaml, /image:\s*casbin\/casdoor@sha256:[0-9a-f]{64}/)
  assert.match(yaml, /127\.0\.0\.1:\d+:8000/)
  assert.match(yaml, /container_name:\s*casdoor-demo/)
})

test("Casdoor: volume de dados é POR PROJETO (dois projetos não compartilham o DB de identidade)", async () => {
  const { casdoorComposeYaml } = await imp()
  // O compose file mora sempre em `.gstack/`, então o project-name default do compose
  // seria "gstack" para TODO projeto — dois projetos acabariam no MESMO volume, com o
  // mesmo banco de usuários. Nome explícito por projeto elimina o vazamento cruzado.
  const a = casdoorComposeYaml("casdoor-alpha")
  const b = casdoorComposeYaml("casdoor-beta")
  const volName = (y) => (y.match(/name:\s*(casdoor-[a-z0-9-]+-data)/) || [])[1]
  assert.equal(volName(a), "casdoor-alpha-data")
  assert.equal(volName(b), "casdoor-beta-data")
  assert.notEqual(volName(a), volName(b), "volumes distintos por projeto")
})

test("FAIL-CLOSED: sem health real, o create NUNCA diz que o Casdoor está rodando", async () => {
  const { startCasdoor } = await imp()
  const lines = []
  const logger = {
    info: (m) => lines.push(`info:${m}`), success: (m) => lines.push(`success:${m}`),
    warn: (m) => lines.push(`warn:${m}`), error: (m) => lines.push(`error:${m}`),
  }
  // `docker compose up -d` responde OK (foi o que o código antigo tratava como prova),
  // mas o container crash-loopa e o HTTP nunca responde — exatamente o bug real.
  const url = startCasdoor(logger, path.join(repoRoot, "nao-existe-dir-de-teste"), "demo", {
    exec: () => Buffer.from("Container casdoor-demo Started"),
    hasDocker: () => true,
    probe: () => false,
    write: () => {},
  })
  assert.equal(url, null, "sem HTTP vivo => sem URL => phases.casdoor = degraded (honesto)")
  const claimed = lines.filter((l) => l.startsWith("success:") && /rodando|ja rodando|reiniciado/i.test(l))
  assert.deepEqual(claimed, [], "CONTROLE NEGATIVO: nenhuma afirmação de 'rodando' sem probe verde")
  assert.ok(lines.some((l) => l.startsWith("warn:") && /nao respondeu|indisponivel/i.test(l)), "reporta falha honesta")
})

test("FAIL-CLOSED: com health real verde, reporta online e devolve a URL de loopback", async () => {
  const { startCasdoor } = await imp()
  const lines = []
  const logger = {
    info: (m) => lines.push(`info:${m}`), success: (m) => lines.push(`success:${m}`),
    warn: (m) => lines.push(`warn:${m}`), error: (m) => lines.push(`error:${m}`),
  }
  const url = startCasdoor(logger, path.join(repoRoot, "nao-existe-dir-de-teste"), "demo", {
    exec: () => Buffer.from("Container casdoor-demo Started"),
    hasDocker: () => true,
    probe: () => true,
    write: () => {},
  })
  assert.equal(url, "http://127.0.0.1:8000", "probe verde => URL real")
  assert.ok(lines.some((l) => l.startsWith("success:") && /rodando/i.test(l)), "só aqui pode afirmar 'rodando'")
  // O aviso de credencial insegura (P0.4) continua obrigatório.
  assert.ok(lines.some((l) => /admin\/123/.test(l) && l.startsWith("warn:")), "mantém o aviso de credencial-padrão")
})

test("casdoorHealthy: só aceita HTTP 2xx; erro de curl/porta morta = false", async () => {
  const { casdoorHealthy } = await imp()
  const fast = { attempts: 2, delayMs: 0 }
  assert.equal(casdoorHealthy("http://127.0.0.1:8000", () => Buffer.from("200"), fast), true)
  // CONTROLE NEGATIVO: container "Up" mas app morto responde 000/502 — não é saúde.
  assert.equal(casdoorHealthy("http://127.0.0.1:8000", () => Buffer.from("000"), fast), false, "curl sem conexão")
  assert.equal(casdoorHealthy("http://127.0.0.1:8000", () => Buffer.from("502"), fast), false, "gateway morto")
  assert.equal(casdoorHealthy("http://127.0.0.1:8000", () => null, fast), false, "exec falhou")
})
