# ADR-006 — Um registry só: `operation-registry` é a autoridade canônica

- **Status:** Accepted
- **Data:** 2026-08-18
- **Contexto PRD:** PRD52 §14 (Sprint 52.7, "Command registry único"), Sprint 52.A.

## Contexto

O PRD52 §14 manda criar `src/meta/command-registry.js` como fonte única de
handler, alias, subcomandos, help, flags, efeitos, consentimento, JSON schema e
camada.

`src/meta/operation-registry.js` já existe, entregue pelo Sprint 51.4.5, e a
comparação formal exigida antes de criar o arquivo novo mostrou sobreposição
quase total.

## Comparação

| campo pedido pelo §14 | `operation-registry` hoje |
|---|---|
| subcomandos | ✅ `subcommand` |
| efeitos | ✅ `effects` — **vocabulário idêntico**, os mesmos 7 termos |
| consentimento | ✅ `requiresConsent` |
| JSON schema | ✅ `jsonSchema` |
| camada | ✅ derivada por `layerOf` |
| handler | ❌ |
| alias | ❌ |
| help | ❌ |
| flags | ❌ |

As três perguntas que decidiriam por um arquivo novo respondem todas "é a mesma
coisa":

- **identidade** — os dois chaveiam por `command` + `subcommand`;
- **ownership** — os consumidores diferem (firewall lê efeitos, CLI leria
  help/dispatch), mas a ENTIDADE descrita é uma só: a operação;
- **lifecycle** — os dois são declaração estática versionada em código.

O que separa os dois não é contrato: é **cobertura**. `operation-registry`
declara escopo honestamente parcial — cobre o que o S51.4.5 auditou de verdade e
recusa afirmar os ~49 comandos do DISPATCH por inferência de nome.

## Decisão

**Estender `operation-registry.js`.** Não criar `command-registry.js`.

Os quatro campos que faltam entram como opcionais, e a ausência deles NÃO é
inferida: um comando sem `handler` declarado não vira "handler pelo nome". Cada
campo novo é preenchido quando a operação for auditada, pelo mesmo critério que
governa o resto do registry.

## Por que não os dois

Dois registries sobre os mesmos comandos produziriam duas verdades, e a segunda
envelheceria calada — exatamente o defeito que o PRD51 acabou de corrigir nos
hooks do Codex, onde `config.toml` e `hooks.json` descreviam o mesmo wiring e só
um era lido. O §14 pede fonte ÚNICA; criar um segundo arquivo para satisfazer a
letra do texto contrariaria o propósito dele.

## Consequências

- o `renomear` fica de fora: o nome `operation-registry` descreve melhor o que a
  entidade é (uma operação com efeitos) do que `command-registry` descreveria;
- o §14 permanece cumprido pela extensão, e os testes de 52.7 apontam para o
  arquivo existente;
- a cobertura parcial continua declarada: expandir o registry exige auditar a
  operação, nunca preencher pelo nome.
