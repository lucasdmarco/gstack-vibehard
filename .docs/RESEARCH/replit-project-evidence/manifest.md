# Replit project evidence — curadoria (PRD42 S42.0E)

**Status:** `archived_reference` (referência histórica; **NUNCA** dependência runtime do GStack).
**Fonte:** dump bruto de um workspace Replit em `.docs/PLANS/replit arquivos/` (35.789 entradas:
objetos git nomeados por SHA, `node_modules`, plugins `@replit/vite-plugin-*`, `.replit`,
`.replitignore`). Curado, não vendorizado — nenhum byte entra no pacote publicável.

## Por que curar (e não importar)

Regra do repositório (`CLAUDE.md`): *"Uma referência metodológica NUNCA vira dependência runtime
do GStack."* Este material é **evidência de como o Replit modela o runtime de um projeto** —
usamos o **schema** como corroboração de design, não o código. Marcado `archived_reference` no
`repository-registry.json`: entra em comparações apenas como referência histórica.

## O que foi extraído (evidência determinística)

O único artefato de valor metodológico é `.replit` (config declarativa do workspace). Ele
corrobora — de forma independente — o desenho do **runtime manifest v3** que o GStack constrói no
S42.6 (`workflows`/`postMerge`/`deploy`/`health`). Ver `findings.json` para o mapa campo→sprint.

Trecho real do `.replit` curado:

```toml
[deployment]
deploymentTarget = "autoscale"
[deployment.postBuild]
args = ["pnpm", "store", "prune"]
[workflows]
runButton = "Project"
[postMerge]
path = "scripts/post-merge.sh"
timeoutMs = 20000
[[ports]]
localPort = 8080
externalPort = 8080
```

## Segurança — deny-patterns que esta curadoria motivou

Varrer dumps de projeto full-stack (Replit-style) expôs artefatos **portadores de credencial**
que o indexador (`src/context-docs/scout.js` → `SCOUT_DENYLIST`) ainda **não cobria**. S42.0E os
adicionou (com teste + controle negativo em `tests/context_scout.test.js`):

| Padrão | Risco |
|---|---|
| `.npmrc` | `_authToken` de registry |
| `.netrc` | credenciais de rede |
| `.git-credentials` | creds git em texto plano |
| `.pgpass` | senha Postgres |
| `*.tfstate` / `*.tfstate.backup` | secrets materializados no state do Terraform |
| `.aws/` | `~/.aws/credentials` |

`.env*`, `secrets/`, chaves (`*.pem`/`id_rsa`) e o vault já eram negados desde o PRD18.

## Limites (honestidade)

- **Não** re-hospedamos nem redistribuímos o dump; ele fica em `.docs/PLANS/` (gitignored) como
  insumo de leitura, não como fonte publicável.
- **Nenhum** plugin `@replit/*` vira dependência: o GStack não roda dentro do Replit e não importa
  seu runtime. O que aproveitamos é **schema como espelho de design**, validado por testes próprios.
- Corroboração ≠ conformidade: o manifest v3 do GStack tem migração e gates próprios (S42.6),
  não copia o `.replit`.
