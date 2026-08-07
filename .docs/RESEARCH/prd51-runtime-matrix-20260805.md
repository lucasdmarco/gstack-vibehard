# PRD51 · Trilha B2 — matriz de compatibilidade do runtime (medição autoritativa)

> **O que esta matriz prova:** que o **pacote real** funciona em Node 18/20/22/24
> **no Windows**.
> **O que ela NÃO prova:** que a suíte de testes roda nessas versões, nem que o
> produto funciona em Linux/macOS. São claims distintas, e confundi-las foi o que
> originou o `P0.NODE-SUPPORT-GATE-INVALID`.

## Âncora

> **Cadeia legível por máquina** (reparada em 2026-08-06):
> [`…20260805.receipt.json`](prd51-runtime-matrix-20260805.receipt.json) é o recibo
> da rodada, versionado **sem BOM** e sem alteração de conteúdo;
> [`…20260805.anchor.json`](prd51-runtime-matrix-20260805.anchor.json) liga recibo,
> tarball e commit por hash, e declara o que a evidência **não** prova.
> `tests/prd51_b2_evidence_chain.test.js` guarda a cadeia.
>
> O recibo chegou ao disco por redirecionamento do PowerShell e ganhou um BOM
> (`EF BB BF`) que fazia `JSON.parse` lançar — a evidência existia, estava certa e
> era **inconsumível**. Ele também não carregava o commit, que vivia só na prosa
> abaixo. Ambos os buracos estão fechados, e o runner passou a emitir
> `origem.commit` para que a reconstrução não precise se repetir.

| Campo | Valor |
|---|---|
| Data | 2026-08-05 |
| Commit | `e5b832dde05687ee54afe871ea5c819ded534620` |
| Árvore no empacotamento | **limpa** |
| Tarball | `gstack-vibehard-installer-5.107.0.tgz` |
| SHA-256 do tarball | `3dfd4fdfc804ab9f865f683c23b88345d0632ca2ffef92439c55dc41b84989ca` |
| Tarball ↔ commit | **1039/1039 arquivos idênticos** por hash de blob; 0 divergentes, 0 ausentes |
| Gerado em | `C:\gs-auth2` — **fora** do repositório |
| Instalação | `--offline` (rede **proibida**), a partir de cache seed verificado |
| Cobertura de SO | `windows_local` — **um** SO |

### Binários, todos conferidos contra `nodejs.org/dist`

```
node-v18.20.8-win-x64.zip  1a1e40260a6facba83636e4cd0ba01eb5bd1386896824b36645afba44857384a
node-v20.19.5-win-x64.zip  c48159529572a5a947eef2d55d6485dfdc4ce8e67216402e2f6de52ad5d95695
node-v22.21.1-win-x64.zip  3c624e9fbe07e3217552ec52a0f84e2bdc2e6ffa7348f3fdfb9fbf8f42e23fcf
node-v24.14.0-win-x64.zip  313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66
```

## Resultado

`completude.ok: true` · nenhuma versão faltando · dez oráculos por linha

| Node | Veredito | doctor | npm | `sqlite_available` | backend observado |
|---|---|---|---|---|---|
| v18.20.8 | **runtime_compatible** | v18.20.8 | 10.8.2 | `false` | `jsonl_fallback` |
| v20.19.5 | **runtime_compatible** | v20.19.5 | 10.8.2 | `false` | `jsonl_fallback` |
| v22.21.1 | **runtime_compatible** | v22.21.1 | 10.9.4 | `true` | `sqlite` |
| v24.14.0 | **runtime_compatible** | v24.14.0 | 11.9.0 | `true` | `sqlite` |

Em todas as linhas, as três provas de identidade coincidiram:
`${nodeAlvo} -p process.version` = `where.exe node` = `doctor.versions.node` = alvo.

### As duas leituras

| Leitura | Resultado | Razão |
|---|---|---|
| `strict` | **fail** | backend difere entre versões: `jsonl_fallback` × `sqlite` |
| `declared_degradation` | **pass** | a degradação é autorizada pela **capacidade ausente** |

`node:sqlite` entra no Node 22.5. Em 18/20 ele não existe, o State Store cai para
`jsonl_fallback`, e essa degradação é **declarada** em `src/state/store.js:25-30`
desde o PRD14. A autorização vem da capacidade **observada** (`sqlite_available:
false`), nunca do número da versão.

## O que isto muda na decisão

A hipótese que originou o P0 era que o produto poderia não funcionar em Node 18.
**Ela foi refutada.** O que falha em Node 18 é a **suíte** (352/561, por
`import.meta.dirname` em 351 arquivos de teste) — nada disso toca o runtime.

Pela regra de decisão acordada, o cenário aplicável é o segundo:

> *Runtime passa, mas suíte não: Node 18/20 podem ser `best_effort`, **nunca
> suporte oficial sem suíte**.*

Node 22 segue **recomendado por segurança** — 18 e 20 estão fora de suporte
upstream em agosto de 2026 —, mas isso agora é decisão de política, não de
compatibilidade.

## Três claims, estado atualizado

| Claim | Antes | Agora | Base |
|---|---|---|---|
| `runtime_compatibility` | `unproven` | **`proved_windows_local`** | esta matriz |
| `suite_compatibility` | `failing` | `failing` | 208 pass / 352 fail |
| `safe_support` | `undecided` | `undecided` | decisão humana, pendente |

## Rodadas DESCARTADAS

Três execuções anteriores foram rotuladas `diagnostic_wip` e **nunca** citadas
como prova. Elas existem no registro porque o que encontraram tem valor:

1. **Acusou `runtime_incompatible` em 18/20/22.** Causa: `doctor` executa
   `execFileSync("node", ["--version"])` (`src/installer/doctor.js:68`), lendo o
   **PATH** — comportamento legítimo do produto, que diagnostica o ambiente do
   usuário. O harness é que não punha o Node alvo no PATH. Aceitar esta rodada
   teria produzido a conclusão errada **confirmando a suspeita inicial pelo
   motivo errado**, que é o desfecho mais difícil de detectar depois.
2. **Abortada**: o harness tinha três rotas que aceitavam evidência incompleta
   (exit 0 sem medição, cache comum descartado, agregação de conjunto parcial).
3. **Tarball contaminado**: continha `scripts/test-runtime-matrix.mjs` ainda não
   commitado, logo não correspondia a commit algum.

Sete defeitos do harness foram corrigidos antes desta medição valer. Todos eram
do instrumento; nenhum do produto.

Um oitavo apareceu **depois** da medição, no transporte da evidência: o recibo
saiu correto do runner e foi corrompido a caminho do disco (BOM do
redirecionamento), além de não carregar o próprio commit. Também do instrumento —
mas com uma diferença que vale registrar: os sete primeiros produziriam medição
errada, e este produziria medição certa e **incitável**, que é o defeito mais
fácil de deixar passar porque o arquivo está lá.

A reconciliação foi por **conteúdo**, não por reempacotamento: `npm pack` não é
byte-reprodutível — o gzip carrega `mtime` —, então divergência de SHA-256 do
`.tgz` não distinguiria conteúdo diferente de horário diferente. Comparou-se o
hash de blob de cada arquivo (`git hash-object --path`, que aplica os mesmos
filtros do commit) contra `git rev-parse <commit>:<caminho>`. 585 dos 1039 só
coincidem após normalização de EOL, porque o tarball saiu de working tree com
CRLF: comparar bytes crus acusaria 585 falsos positivos.

## Limites declarados

- **Um SO.** Linux e macOS dependem do workflow `runtime-compat.yml`, que
  permanece **`unproven`** até uma execução real no GitHub.
- Runners do GitHub provam `ci_runner_cross_os` — máquinas provisionadas, **não**
  desktops limpos.
- `engines` **não** foi alterado. `P0.NODE-SUPPORT-GATE-INVALID` segue **aberto**:
  ele fecha com decisão humana sobre o contrato público, não com esta medição.
