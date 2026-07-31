import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const read = (rel) => readFileSync(path.join(root, rel), "utf-8")

// Guard dos 2 bugs reais que o tsc (checkJs) pegou — `node --check` NÃO pega
// ReferenceError de import/escopo faltando, então travamos por texto.
test("regressão: install.js IMPORTA confirm (não é global no Node)", () => {
  const s = read("src/installer/install.js")
  assert.match(s, /import \{[^}]*\bconfirm\b[^}]*\} from "\.\.\/cli\/index\.js"/, "confirm precisa ser importado, senão crasha no install interativo")
  // PRD51 S51.10.2: a asserção era `/await confirm\(/`, presa à FORMA da chamada. O
  // S51.10.2 tornou o gate de consentimento injetável (`deps.confirm || confirm`) para
  // conseguir testar a RECUSA, e o literal deixou de casar — sem que o risco original
  // mudasse. O que este guard existe para impedir é `confirm` virar global de browser:
  // um import morto reintroduziria o ReferenceError no install interativo. Agora a
  // asserção é sobre isso — o binding importado precisa ser REFERENCIADO no código.
  // Só CÓDIGO conta. Exclui imports, comentários (a prosa deste arquivo menciona
  // `confirm` várias vezes) e acesso por propriedade (`deps.confirm`) — sem os três
  // filtros o guard passa com o import morto, que é exatamente o que ele deve pegar.
  const codigo = s
    .replace(/^import[\s\S]*?from ".*?"$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
  assert.match(codigo, /(^|[^.\w])confirm\b/m, "o binding importado precisa ser usado — import morto traz o ReferenceError de volta")
})

test("regressão: sprint.js declara pyCmd FORA do try (usado no catch)", () => {
  const s = read("src/commands/sprint.js")
  // `let pyCmd` antes do try; o catch referencia pyCmd na mensagem de ENOENT
  assert.match(s, /let pyCmd[\s\S]{0,80}\btry\s*\{/, "pyCmd deve ser declarado fora do try")
  assert.doesNotMatch(s, /try \{\s*\n\s*const pyCmd =/, "não pode voltar a ser const dentro do try")
})

// Infra B3: .d.ts dos contratos + jsconfig + bench existem e são válidos.
test("B3 infra: tipos dos contratos (.d.ts), jsconfig e bench presentes", () => {
  const dts = read("types/contracts.d.ts")
  for (const iface of ["RuntimeManifest", "SecretsSchema", "AgentManifestV2", "AttestationReceipt"]) {
    assert.match(dts, new RegExp(`interface ${iface}\\b`), `${iface} declarado`)
  }
  assert.match(read("jsconfig.json"), /"checkJs"/)
  const pkg = JSON.parse(read("package.json"))
  assert.ok(pkg.scripts.coverage && pkg.scripts["coverage:ci"] && pkg.scripts.bench, "scripts coverage/bench")
  assert.ok(pkg.devDependencies.c8 && pkg.devDependencies.typescript, "devDeps c8 + typescript")
})
