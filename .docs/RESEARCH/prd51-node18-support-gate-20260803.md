# PRD51 · P0.NODE-SUPPORT-GATE-INVALID — evidência medida

> Achado da certificação do RC, **separado da Fase 1B**. Os arquivos da Fase 1B
> passam em Node 18 real; o repositório não.

## Âncora

| Campo | Valor |
|---|---|
| Data | 2026-08-03 |
| Commit medido | `5ede986` (merge da Fatia 2.1) |
| Runtime | Node **18.20.8** win-x64, binário oficial portátil |
| Comando | `node --test tests/` |

## Classificação (registro humano, verbatim)

```
declared_support:            node >=18
phase1b_compatibility:       proved_on_node18
repository_suite_on_node18:  failing
node18_support_claim:        unproven
ci_gate_status:              structurally_invalid
cause:                       import.meta.dirname em 351 arquivos
blocker:                     release_support_decision
```

## Medição

| Métrica | Valor |
|---|---|
| Testes executados | 561 |
| Pass | **208** |
| Fail | **352** |
| Skip | 1 |
| Arquivos de teste usando `import.meta.dirname` | **351** |
| Falhas atribuíveis à Fase 1B | **0** |
| Arquivos da Fase 1B em Node 18 | **74 / 74 pass** |

`import.meta.dirname` existe a partir do Node 20.11; em Node 18 vale `undefined`,
e `path.resolve(undefined, "..")` lança `ERR_INVALID_ARG_TYPE` no carregamento do
módulo — o arquivo inteiro falha antes de qualquer teste rodar.

## Por que o gate nunca foi válido

O job `test-node-matrix` (`.github/workflows/test.yml:48`) nasceu no S51.10.2 com
propósito declarado no próprio workflow: *"as três versões só rodavam no job
`doctor`, que executa UM comando. Uma regressão exclusiva do Node 18 passaria
batido. Aqui a suíte INTEIRA roda no mínimo e no LTS."*

O que passou batido foi que a suíte **não roda** no mínimo. Um gate que reprova
por incompatibilidade estrutural não distingue regressão de nada: ele reprova
sempre, e reprovar sempre carrega a mesma informação que não existir.

Consequência para o RC: `engines.node >= 18` é uma **claim pública sem prova**.

## Como o achado apareceu

Uma revisão apontou `fs.globSync` (Node ≥ 22) num teste da Fase 1B, contra
`engines >= 18`. Corrigi. Em vez de raciocinar sobre compatibilidade, baixei um
Node 18 real e rodei — e o que apareceu foi maior que o apontado.

Registro do método, porque ele é o ponto: a incompatibilidade do `globSync` era
dedutível por leitura; a dos 351 arquivos só apareceu executando.

## Proibições explícitas (decisão humana, 2026-08-03)

- **Não** aceitar as 352 falhas como baseline.
- **Não** desabilitar o job.
- **Não** marcar Node 18 como suportado.
- **Não** alterar `engines` antes da decisão.
- **Não** corrigir os 351 arquivos dentro da Fase 1B.

## Decisão pendente

| Opção | Descrição | Exige |
|---|---|---|
| **A** (recomendada) | Mínimo Node 22; matriz 22/24 | package.json, doctor, instalador, documentação, matriz de capacidades; remover claim de Node 18/20; provar instalação limpa em Node 22 |
| **B** | Manter Node 18 | frente separada migrando 351 arquivos para `fileURLToPath(import.meta.url)`, com suíte verde em Node 18 antes de qualquer claim |

Contexto que pesa em favor de A: em agosto de 2026, Node 18 e Node 20 já estão
fora de suporte upstream.

## Reprodução

```bash
# Node 18.20.8 portátil, fora do projeto
node --test tests/                       # 208 pass / 352 fail
node --test tests/i18n_js_ast.test.js \
     tests/i18n_js_ast_binding.test.js \
     tests/i18n_js_ast_sinks.test.js \
     tests/i18n_js_registry.test.js      # 74 pass / 0 fail
```
