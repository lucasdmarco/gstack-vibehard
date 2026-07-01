# MCP Connector Policy — gstack_vibehard

Status: ativa (PRD14 §4.13)

MCP em excesso explode o contexto do agente (cada servidor injeta um tool set
inteiro em toda sessão) e confunde o usuário. Esta política governa o que pode
ser MCP **default** no gstack e como auditamos o estado real da máquina.

## Regra de admissão de MCP default

Um servidor MCP só entra como **default** (escrito pelo `install` completo) se
passar nos DOIS critérios:

1. **Universal** — útil para quase todo usuário do gstack, em quase todo projeto
   (não vertical, não nicho, não dependente de conta paga).
2. **MCP > CLI/API/skill** — o formato MCP precisa vencer as alternativas por
   exigir algo que só ele dá: sessão interativa/stateful, streaming, auth
   handshake do lado do harness ou browsing estruturado. Se um comando CLI ou
   uma skill resolve igual, **não vira MCP default** (custa contexto à toa).

Resultado esperado: o conjunto default fica **perto de zero a dois** conectores.
Todo o resto é **opt-in** (`install --mcp-server <nome>`, `tools mcp enable`,
project-scoped sempre que possível).

## Escopo por modo de instalação

| Modo | Escrita de MCP global |
|---|---|
| `install` completo | Baseline default conforme esta política; **opt-out** `--no-global-mcp` |
| `install --project-only` | **Nunca** escreve MCP global |
| `create` lite (default) | **Nunca** escreve MCP global |
| `tools mcp enable <tool>` | Só `.mcp.json` **do projeto** |

## Inventário e auditoria

`gstack_vibehard tools mcp inventory [--json] [--fragmented]` lê as configs de
**Claude** (`~/.mcp.json`, `~/.claude.json`), **Codex** (`~/.codex/config.toml`),
**OpenCode** (`~/.config/opencode/opencode.json[c]`) e do **projeto**
(`./.mcp.json`) e reporta:

- servidores por harness (transport, comando redigido);
- **fragmentação**: o mesmo servidor declarado em 2+ fontes (contexto duplicado);
- agregados: `serverCount`, `harnessCount`, `duplicateServerCount`,
  `serversWithSecrets`.

### Regras de segurança do inventário

- **Nenhum valor de env é emitido** — só nomes (`envKeys`) e quais nomes parecem
  credencial (`secretEnvKeys`).
- args/URLs passam por redaction (`***REDACTED***` + fingerprint interno).
- Leitores são **read-only** e tolerantes: config ausente → `exists:false`;
  inválida → `valid:false` com o erro resumido. Nunca crash, nunca reescrita.

## Antes de ampliar MCP global

Qualquer proposta de novo MCP default exige, nesta ordem:

1. rodar `tools mcp inventory --json` e anexar o estado atual (tool count,
   duplicidade);
2. justificar os dois critérios de admissão por escrito (PR);
3. mostrar a alternativa CLI/skill considerada e por que perde;
4. atualizar esta política e o README (matriz full/lite).
