---
name: create-hook
description: "Cria hooks para eventos do agente no Codex. Use quando quiser automatizar comportamento em torno de eventos como sessionStart, preToolUse, ou afterFileEdit."
---

# Creating Hooks

No Codex Desktop, hooks podem ser configurados via MCP servers. O Codex CLI não tem sistema de hooks como o Cursor, mas podemos simular com:

1. **MCP servers** — ferramentas que o agente chama automaticamente
2. **Skills** — instruções que o agente segue em determinados contextos
3. **Scripts** — PowerShell scripts que rodam em eventos

## Hook: Session Start (Recomendado)

Crie um script que roda no início de cada sessão:

```powershell
# ~/.agents/hooks/session-start.ps1
Write-Host "=== Ambiente Carregado ===" -ForegroundColor Cyan
Write-Host "Stack: React + shadcn + Express + Drizzle + Supabase"
Write-Host "Playwright MCP: $(if (Get-Command npx -ErrorAction SilentlyContinue) { 'disponível' } else { 'não instalado' })"
```

Configure no `~/.codex/config.toml` para executar via MCP:

```toml
[mcp_servers.session-hook]
command = "powershell"
args = ["-File", "$env:USERPROFILE\\.agents\\hooks\\session-start.ps1"]
```

## Hook: Pré-Tool (Validar Comandos)

Crie um MCP server simples que valida comandos antes de executar:

```javascript
// ~/.agents/hooks/validate-shell.mcp.js
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const { command } = JSON.parse(line);
  const blocked = ['rm -rf', 'git push --force', 'DROP TABLE'];

  if (blocked.some(b => command.includes(b))) {
    console.log(JSON.stringify({
      permission: "deny",
      message: `Comando bloqueado por segurança: ${command}`
    }));
  } else {
    console.log(JSON.stringify({ permission: "allow" }));
  }
});
```

```toml
[mcp_servers.validate-shell]
command = "node"
args = ["$env:USERPROFILE\\.agents\\hooks\\validate-shell.mcp.js"]
```

## Hook: Pós-Edit (Formatar Arquivos)

Use uma skill que instrui o agente a formatar após editar:

```markdown
# after-file-edit (skill)
Após editar qualquer arquivo TypeScript/React, execute:
npx prettier --write <arquivo>
```

## Alternativa: Usar Skills em Vez de Hooks

No Codex, skills são mais naturais que hooks:

```markdown
# Toda vez que o usuário pedir para criar um componente:
1. Use shadcn components
2. Crie o arquivo em apps/web/src/components/
3. Teste com Playwright MCP
4. Garanta loading/error/empty states
```

A skill é ativada automaticamente quando o nome/description corresponde ao prompt do usuário.
