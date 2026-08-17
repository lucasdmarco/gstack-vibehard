import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * FRONTEIRA DO INVENTARIO PYTHON.
 *
 * Ate aqui o inventario varria `hooks/` e mais nada — um caminho literal, sem
 * uma linha dizendo por que aquele e nao outro. C-4(a) mostrou o custo: os
 * quatro repasses de `context.js` encaminham, sem moldura, o stdout de
 * `src/context-docs/py/context_db.py`, que viaja no pacote e imprime prosa
 * escrita pelo GStack — e nenhuma daquelas frases era contada em lugar algum.
 *
 * TROCAR UM CAMINHO LITERAL POR DOIS repetiria o erro num arquivo a mais. O que
 * decide e o CRITERIO, e ele tem duas condicoes que precisam valer juntas:
 *
 *   DISTRIBUIDO   o arquivo sai no tarball (`package.json#files`);
 *   ALCANCAVEL    ha execucao real declarada, com evidencia nomeada.
 *
 * A segunda condicao nao e cerimonia: o manifesto publica 40 arquivos `.py`
 * (361 pontos de emissao), quase todos script de skill que a CLI nunca dispara.
 * Medido, nao estimado.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`)
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

// ── A fronteira no repositorio real ────────────────────────────────────────

test("os hooks continuam contados — a fronteira nova nao pode perder cobertura", async () => {
  const { distributedPythonFiles } = await imp()
  const fronteira = distributedPythonFiles(repoRoot)
  const hooks = [...fronteira.keys()].filter((f) => f.startsWith("hooks/"))
  // 16 -> 15 com a remocao de `before_shell.py`, hook distribuido que nenhum
  // harness registrava. A fronteira encolheu porque a SUPERFICIE encolheu.
  assert.ok(hooks.length >= 15, `esperado o conjunto inteiro de hooks, veio ${hooks.length}`)
  assert.ok(hooks.includes("hooks/hooks/stop.py"))
  for (const f of hooks) assert.equal(fronteira.get(f).kind, "harness_hook")
})

test("`context_db.py` entra, e como subprocesso de CLI — nao como hook", async () => {
  const { distributedPythonFiles } = await imp()
  const raiz = distributedPythonFiles(repoRoot).get("src/context-docs/py/context_db.py")
  assert.ok(raiz, "o indexer precisa estar na fronteira")
  assert.equal(raiz.kind, "cli_subprocess")
  assert.match(raiz.runner, /context\.js/)
})

/**
 * A CONDICAO 2 SENDO PORTA, medida contra o repositorio.
 *
 * Sem ela a fronteira teria os 40 `.py` do manifesto. Este teste fixa que
 * `agents/skills/**` — que E distribuido — fica de fora, porque nada em `src/`
 * o dispara. Se um dia a CLI passar a chamar um deles, a raiz precisa ser
 * declarada, e o controle de deriva abaixo cobra isso.
 */
test("Python distribuido mas NAO alcancado pelo runtime fica de fora", async () => {
  const { distributedPythonFiles } = await imp()
  const fronteira = distributedPythonFiles(repoRoot)
  assert.equal(fronteira.size, 16, "15 hooks + 1 subprocesso de CLI")
  for (const f of fronteira.keys()) {
    assert.ok(!f.startsWith("agents/"), `script de skill nao e disparado pela CLI: ${f}`)
    assert.ok(!f.startsWith("scripts/"), `ferramenta de mantenedor nao entra: ${f}`)
  }
})

/**
 * CONTROLE DE DERIVA — a parte que impede a lista de envelhecer calada.
 *
 * Varre TODO `src/` com o provador de origem de C-4(a) e exige que cada
 * artefato Python disparado dali esteja declarado em `PYTHON_RUNTIME_ROOTS`.
 * Um `execFileSync` novo apontando para um `.py` do pacote quebra este teste no
 * mesmo commit em que for escrito — que e o unico momento em que alguem ainda
 * sabe qual e o consumidor.
 */
test("DERIVA: todo `.py` disparado por `src/` esta declarado na fronteira", async () => {
  const { createAnalyzer, chamadaDeSubprocesso, segmentosDeCaminho } = await eng()
  const { PYTHON_RUNTIME_ROOTS } = await imp()
  const declarados = PYTHON_RUNTIME_ROOTS.map((r) => r.path)

  const { readdirSync, statSync } = await import("node:fs")
  const varrer = (dir, out = []) => {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === ".git") continue
      const p = path.join(dir, n)
      if (statSync(p).isDirectory()) varrer(p, out)
      else if (/\.(js|mjs|cjs)$/.test(n)) out.push(p)
    }
    return out
  }
  const arquivos = varrer(path.join(repoRoot, "src"))
  const a = createAnalyzer(arquivos)

  const achados = new Set()
  for (const f of arquivos) {
    const sf = a.program.getSourceFile(f)
    if (!sf) continue
    const ctx = { checker: a.checker, sf, repoRoot }
    const candidatos = (n) => (ts.isArrayLiteralExpression(n) ? [...n.elements] : [n])
    const visitar = (n) => {
      const s = chamadaDeSubprocesso(n, a.checker)
      if (s) {
        for (const arg of s.arguments.flatMap(candidatos)) {
          const segs = segmentosDeCaminho(arg, ctx)
          if (segs?.some((x) => String(x).endsWith(".py"))) achados.add(segs.filter((x) => String(x).endsWith(".py"))[0])
        }
      }
      ts.forEachChild(n, visitar)
    }
    visitar(sf)
  }

  for (const py of achados) {
    assert.ok(
      declarados.some((d) => d.endsWith(py) || d === "hooks"),
      `\`${py}\` e disparado por src/ e nao esta em PYTHON_RUNTIME_ROOTS — declare a raiz com runner e evidencia`,
    )
  }
  assert.ok(achados.has("context_db.py"), "o provador precisa continuar enxergando o spawn do indexer")
})

// ── As portas, exercitadas em repositorio de fixture ───────────────────────

/** Repo minimo: manifesto + arquivos, para exercitar as portas isoladamente. */
function repoFixture({ files, arquivos }) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-pyfront-"))
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0", files }))
  for (const [rel, corpo] of Object.entries(arquivos)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, corpo)
  }
  return root
}

const CORPO_PY = 'print("uma frase")\n'

/**
 * As raizes declaradas sao as do PRODUTO, e o fixture nao tem como declarar
 * outras. Por isso as portas sao exercitadas nas raizes reais (`hooks/` e o
 * caminho do indexer), com o MANIFESTO variando — que e exatamente a condicao 1.
 */
const fronteiraDe = async (root) => (await imp()).distributedPythonFiles(root)

test("PORTA: fora de `package.json#files`, o arquivo NAO entra na fronteira", async (t) => {
  const root = repoFixture({ files: ["src/"], arquivos: { "hooks/hooks/x.py": CORPO_PY } })
  t.after(() => cleanupTmp(root))
  assert.equal((await fronteiraDe(root)).size, 0, "o manifesto nao publica `hooks/`")
})

test("PORTA: dentro de `files`, o mesmo arquivo entra", async (t) => {
  const root = repoFixture({ files: ["hooks/"], arquivos: { "hooks/hooks/x.py": CORPO_PY } })
  t.after(() => cleanupTmp(root))
  assert.deepEqual([...(await fronteiraDe(root)).keys()], ["hooks/hooks/x.py"])
})

/**
 * O CONTROLE PEDIDO EXPLICITAMENTE: tirar o diretorio do manifesto tira o
 * arquivo da fronteira, sem editar este modulo. E o que faz a condicao 1 ser
 * derivacao, e nao decoracao.
 */
test("PORTA: remover a entrada do manifesto retira o arquivo da fronteira", async (t) => {
  const arquivos = { "hooks/hooks/x.py": CORPO_PY }
  const dentro = repoFixture({ files: ["hooks/"], arquivos })
  const fora = repoFixture({ files: ["hooks/outro/"], arquivos })
  t.after(() => { cleanupTmp(dentro); cleanupTmp(fora) })
  assert.equal((await fronteiraDe(dentro)).size, 1)
  assert.equal((await fronteiraDe(fora)).size, 0)
})

test("PORTA: teste, fixture, cache e venv nao entram, mesmo publicados", async (t) => {
  const root = repoFixture({
    files: ["hooks/"],
    arquivos: {
      "hooks/hooks/real.py": CORPO_PY,
      "hooks/hooks/test_real.py": CORPO_PY,
      "hooks/hooks/real_test.py": CORPO_PY,
      "hooks/hooks/conftest.py": CORPO_PY,
      "hooks/tests/outro.py": CORPO_PY,
      "hooks/hooks/fixtures/dado.py": CORPO_PY,
      "hooks/hooks/__pycache__/real.py": CORPO_PY,
      "hooks/hooks/.venv/lib/pkg.py": CORPO_PY,
    },
  })
  t.after(() => cleanupTmp(root))
  assert.deepEqual([...(await fronteiraDe(root)).keys()], ["hooks/hooks/real.py"])
})

// ── Efeito no censo e no registro de consumidores ──────────────────────────

/**
 * A FRONTEIRA ENTREGA PONTOS, e a especie decide quem os classifica. O que cada
 * ponto vira e assunto de tests/i18n_python_cli_rules.test.js; aqui a pergunta e
 * se eles chegaram, e por qual raiz.
 */
test("os 19 pontos do indexer entram no inventario pela raiz de CLI", async () => {
  const { buildInventory, distributedPythonFiles } = await imp()
  const pts = buildInventory({ repoRoot }).points.filter((p) => p.file.endsWith("context_db.py"))
  assert.equal(pts.length, 19, "12 print + 6 json + 1 stderr")
  assert.equal(pts.filter((p) => p.sink === "print").length, 12)
  assert.equal(distributedPythonFiles(repoRoot).get("src/context-docs/py/context_db.py").kind, "cli_subprocess")
})

/**
 * A declaracao dos hooks NAO pode cobrir o indexer por colisao de sink. Antes da
 * ancora, `sink: "json"` valia para o repositorio inteiro e teria adotado os seis
 * pontos do indexer com um consumidor que fala de protocolo de hook.
 */
test("consumidor de `machine_protocol` e ancorado: hook nao adota o indexer", async () => {
  const { buildInventory, machineProtocolAudit, MACHINE_PROTOCOL_CONSUMERS } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(machineProtocolAudit(inv).ok, true)

  const doHook = MACHINE_PROTOCOL_CONSUMERS.find((c) => c.sink === "json" && c.file === "hooks/")
  assert.ok(doHook, "a entrada dos hooks precisa estar ancorada em `hooks/`")

  const semAncoraDoHook = MACHINE_PROTOCOL_CONSUMERS.filter((c) => c !== doHook)
  const orfaos = inv.points.filter((p) => p.file.endsWith("context_db.py") && p.audience === "machine_protocol")
  assert.equal(orfaos.length, 10, "6 pelo sink `json` + 4 pelo `print` de serializacao pura")
  assert.equal(machineProtocolAudit({ points: orfaos }, semAncoraDoHook).ok, true,
    "os dez precisam ter declaracao PROPRIA, e nao herdada")
  // O SUBCONJUNTO DE MESMO SINK e o que discrimina, e so ele. Confrontar a
  // declaracao do hook com os dez pontos deixava o teste passar por acidente: os
  // quatro de sink `print` ja escapam por canal, e o veredito `false` vinha
  // dali, nao da ancora. O mutation control mostrou — apagar a ancora nao
  // quebrava nada.
  const mesmoSink = orfaos.filter((p) => p.sink === doHook.sink)
  assert.equal(mesmoSink.length, 6)
  assert.equal(machineProtocolAudit({ points: mesmoSink }, [doHook]).ok, false,
    "mesmo canal, arquivo diferente: a declaracao do hook NAO pode cobrir o indexer")

  // E o inverso, que nomeia o que a ancora impede: sem `file`, a mesma
  // declaracao adota o indexer so por coincidencia de canal.
  const semAncora = { ...doHook, file: undefined }
  assert.equal(machineProtocolAudit({ points: mesmoSink }, [semAncora]).ok, true,
    "sem `file`, a declaracao do hook cobre por canal e adota arquivo que nao descreve")
})

/**
 * SUBPROCESSO DO PRODUTO NAO VIRA `external_passthrough` — a decisao de C-4(a),
 * agora com a outra metade no lugar: a origem passou a ser contada.
 */
test("o indexer e do pacote, e por isso nunca cai em `external_passthrough`", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(inv.byAudience.external_passthrough || 0, 0)
  assert.ok(inv.points.some((p) => p.file.endsWith("context_db.py")),
    "e a prova de que ele nao sumiu: esta contado, com pontos proprios")
})
