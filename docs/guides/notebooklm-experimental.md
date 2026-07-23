# NotebookLM connector — experimental, cloud, não-oficial

`research notebooklm` é um conector **opcional e experimental** pra pesquisa
source-grounded na nuvem. Não é local, não é grátis, e não é uma API oficial suportada
pelo Google — é uma integração com `teng-lin/notebooklm-py` (MIT), citado apenas como
referência não-oficial.

> **Nunca vira memória automática, nunca é gate de release.** Um resultado importado
> nunca entra na memória/contexto local sem citação de fonte + aprovação explícita.

## Comandos

```
gstack_vibehard research notebooklm doctor --json
gstack_vibehard research notebooklm connect
gstack_vibehard research notebooklm query --notebook <id> --question <texto> --json
gstack_vibehard research notebooklm import --result <artefato> --to context|obsidian --approved
```

## `connect` é sempre interativo

`resolveConnectMode()` sempre retorna `"interactive_required"` — **mesmo com `--yes`**.
Não existe caminho automatizado de conexão. O adaptador nunca importa cookies de
navegador automaticamente (`AUTO_COOKIE_IMPORT_ENABLED` é sempre `false`,
`attemptAutomaticCookieImport()` sempre recusa) e nunca loga estado de autenticação
(`redactAuthLog` remove `cookie=`/`session_token=`/`auth_state=` de qualquer log).

## Falhas degradam honestamente

Qualquer falha de schema/quota/auth vira `degraded_external_service` — nunca trava,
nunca finge sucesso. Categoria desconhecida também degrada (nunca um crash silencioso).

## Importação exige citação + aprovação

`--approved` precisa ser passado explicitamente na linha de comando (nunca implícito via
`--yes`), e o resultado precisa ter `sourceCitations` não-vazio. Faltando qualquer um
dos dois, a importação é recusada.

## Testes: cassetes VCR escrubados

`tests/fixtures/notebooklm/scrubbed-cassettes/` contém fixtures SINTÉTICAS — nenhum
cookie, token ou dado pessoal real. Um teste de proveniência varre os cassetes
procurando por padrões sensíveis (cookie=, session_token, Bearer token, e-mail) e falha
se algum aparecer.

## Limite honesto desta versão

- Nenhum ambiente Python pinado real está configurado nesta sessão — `doctor` sempre
  reporta `not_configured`, nunca finge estar conectado.
- Testes ao vivo contra a API real são **opt-in e nunca gate de release** (não existem
  nesta sessão — não há credencial real configurada).
- `--approved` é uma flag explícita de linha de comando, não uma UI de aprovação
  interativa completa — é a aproximação honesta disponível sem uma camada de prompt
  dedicada.
