# TESTESLLM.MD — Bateria de Testes para Agentes LLM

**Projeto:** @gstack-vibehard/installer v0.1.0
**Propósito:** Verificar se o instalador funciona em todos os cenários e encontrar pontas soltas
**Execução estimada:** ~45min
**Total de testes:** 98

---

## Como usar

Cada teste tem formato padronizado:

```markdown
### TC-XX.Y: Nome do teste
**Arquivo:** caminho/para/arquivo.js:linha
**Propósito:** O que este teste verifica
**Setup:** Comandos para preparar o ambiente (se houver)
**Comando:** Comando para executar o teste
**Esperado:** O que deve acontecer
**Pós-teste:** Como restaurar o estado original
**Criticidade:** CRITICO | ALTO | MEDIO | BAIXO
```

Execute em ordem. Se um teste CRITICO falhar, pare e reporte o bug.

---

## TC-01: Static Analysis (12 testes)
_Code review sem executar o código. Apenas leia os arquivos e verifique._

### TC-01.1: TOML paths no codex.js
**Arquivo:** `src/harness/codex.js:31-44`
**Propósito:** Garantir que paths no config.toml usam `/` (forward slash) em vez de `\` (backslash), porque TOML interpreta `\U`, `\l`, `\h` como escapes Unicode
**Comando:** `cat src/harness/codex.js | grep -E 'hooksDir|skills_dir'`
**Esperado:** Todas as interpolações de path contêm `.replaceAll("\\", "/")`
**Criticidade:** CRITICO — Bug já encontrado, TOML crash com `too few unicode value digits`

### TC-01.2: Import consistency — homedir() vs HOME
**Arquivo:** `src/installer/install.js:120`
**Propósito:** `homedir()` é importado como função mas `const HOME = homedir()` já foi definido na linha 13. Usar `homedir()` diretamente vs `HOME` pode causar inconsistência
**Comando:** `grep -n 'homedir()' src/installer/install.js`
**Esperado:** `homedir()` só aparece na definição da linha 13 (`const HOME = homedir()`). O resto do arquivo usa `HOME`
**Criticidade:** MEDIO

### TC-01.3: MCP template vars como strings literais
**Arquivo:** `src/harness/claude.js:82,94`
**Propósito:** `${SUPABASE_PROJECT_REF}` e `${CONTEXT7_API_KEY}` são strings literais no JSON — o usuário precisa substituí-las manualmente. Verificar se há documentação/instrução sobre isso
**Comando:** `grep -n '\${SUPABASE_PROJECT_REF}\|\${CONTEXT7_API_KEY}' src/harness/claude.js`
**Esperado:** Essas variáveis existem e há algum mecanismo (skill, regra, etc) que instrua o usuário a preenchê-las
**Criticidade:** ALTO — MCP servers vão falhar se não forem configurados

### TC-01.4: skills_dir TOML no codex.js
**Arquivo:** `src/harness/codex.js:39`
**Propósito:** `skills_dir` no TOML precisa de forward slashes igual aos hooks
**Comando:** `grep -n 'skills_dir' src/harness/codex.js`
**Esperado:** `skills_dir` usa `.replaceAll("\\", "/")` (confirmar que foi aplicado)
**Criticidade:** CRITICO

### TC-01.5: Unused imports
**Arquivo:** Todos os `.js` em `src/`
**Propósito:** Imports não usados poluem o código e podem indicar lógica faltando
**Comando:** Para cada arquivo em `src/`, verifique se cada import é usado no arquivo
**Criticidade:** BAIXO

### TC-01.6: package.json — test script ausente
**Arquivo:** `package.json`
**Propósito:** Não há script `"test"` definido. Projetos Node.js devem ter um test script
**Comando:** `node -e "const p = require('./package.json'); console.log(p.scripts?.test || 'MISSING')"`
**Esperado:** Deve mostrar algo como `"echo \\"No tests yet\\""` no mínimo, ou um test runner configurado
**Criticidade:** MEDIO

### TC-01.7: package.json — files array vs realidade
**Arquivo:** `package.json:19-29`
**Propósito:** O array `files` lista o que será publicado no npm. Verificar se todos existem e se nenhum arquivo necessário foi esquecido
**Comando:**
```bash
# Para cada entrada em "files", verificar se existe no disco
node -e "const p = require('./package.json'); p.files.forEach(f => { try { require('fs').accessSync(f); console.log('OK: ' + f); } catch { console.log('MISSING: ' + f); } })"
```
**Esperado:** Todos os diretórios/arquivos listados existem
**Criticidade:** ALTO — npm publish vai quebrar

### TC-01.8: .gitignore coverage
**Arquivo:** `.gitignore`
**Propósito:** Verificar se .gitignore cobre tudo que não deve ir pro git
**Comando:** Verificar se `.bak`, `*.log`, `.env`, `node_modules/`, `dist/` estão no .gitignore
**Criticidade:** MEDIO

### TC-01.9: ESM vs CJS consistency
**Arquivo:** `package.json:6` + todos `src/**/*.js`
**Propósito:** O projeto usa `"type": "module"` (ESM). Verificar que nenhum arquivo usa `require()` em vez de `import`
**Comando:** `grep -rn 'require(' src/ --include='*.js'`
**Esperado:** Nenhum resultado (zero `require()` calls)
**Criticidade:** ALTO — Runtime error se misturar

### TC-01.10: Hardcoded API keys ou secrets
**Arquivo:** Todos os arquivos
**Propósito:** Garantir que nenhuma chave de API, token ou senha está hardcoded
**Comando:** `grep -rni 'api.key\|api_key\|secret\|token\|password\|sk-[a-zA-Z0-9]\{20,\}' src/ --include='*.js' --include='*.md' --include='*.py'`
**Esperado:** Nenhum resultado (ou apenas falsos positivos em exemplos/documentação)
**Criticidade:** CRITICO

### TC-01.11: Error handling — try/catch coverage
**Arquivo:** `src/installer/install.js`
**Propósito:** Toda chamada de `execSync` deve estar dentro de try/catch. `run()` já trata, mas chamadas diretas podem crashar
**Comando:**
```bash
grep -n 'execSync' src/installer/install.js | grep -v 'try\|catch\|function run'
```
**Esperado:** Toda linha com `execSync` deve ter `try` antes ou estar dentro de `run()`
**Criticidade:** ALTO

### TC-01.12: Shebang no entry point
**Arquivo:** `src/index.js:1`
**Propósito:** O binário precisa de shebang `#!/usr/bin/env node` para funcionar como CLI global
**Comando:** `head -1 src/index.js`
**Esperado:** `#!/usr/bin/env node`
**Criticidade:** ALTO — `gstack_vibehard` command não funciona sem shebang

---

## TC-02: Harness Detection (8 testes)
_Testa src/harness/detector.js_

### TC-02.1: Codex detection via config.toml
**Arquivo:** `src/harness/detector.js:14-19`
**Setup:** Ter `~/.codex/config.toml` presente
**Comando:** `node -e "import('./src/harness/detector.js').then(m => console.log(JSON.stringify(m.detectHarnesses())))"`
**Esperado:** Array contém objeto com `id: "codex"`
**Criticidade:** ALTO

### TC-02.2: Codex detection via binary in PATH
**Arquivo:** `src/harness/detector.js:18`
**Setup:** Remover `~/.codex/config.toml` e `~/.codex/hooks/` (temporariamente). `codex --version` deve funcionar no PATH
**Comando:** Mesmo comando do TC-02.1
**Esperado:** Array contém objeto com `id: "codex"` (detectado pelo binário)
**Pós-teste:** Restaurar config.toml e hooks
**Criticidade:** ALTO

### TC-02.3: Claude detection via settings.json
**Setup:** Ter `~/.claude/settings.json` presente
**Comando:** `node -e "import('./src/harness/detector.js').then(m => console.log(JSON.stringify(m.detectHarnesses())))"`
**Esperado:** Array contém objeto com `id: "claude"`
**Criticidade:** ALTO

### TC-02.4: OpenCode detection via config
**Setup:** Ter `~/.config/opencode/opencode.json` presente
**Comando:** Mesmo comando do TC-02.1
**Esperado:** Array contém objeto com `id: "opencode"`
**Criticidade:** ALTO

### TC-02.5: OpenCode detection via binary only
**Setup:** Remover `~/.config/opencode/opencode.json` (temporariamente). `opencode --version` deve funcionar
**Comando:** Mesmo comando do TC-02.1
**Esperado:** Array contém objeto com `id: "opencode"` (detectado pelo binário)
**Pós-teste:** Restaurar opencode.json
**Criticidade:** ALTO

### TC-02.6: No harnesses detected
**Setup:** Nenhum harness instalado (máquina limpa)
**Comando:** Mesmo comando do TC-02.1
**Esperado:** Array vazio `[]`
**Criticidade:** MEDIO

### TC-02.7: Binary detection timeout
**Arquivo:** `src/harness/detector.js:18,31,45`
**Propósito:** `execSync` com timeout de 3s pode travar se o comando não existir. Verificar se o timeout está adequado
**Comando:** Inspecionar `execSync("... --version", { timeout: 3000 })` em cada detect()
**Esperado:** Todos os `execSync` têm `timeout` definido (não podem travar para sempre)
**Criticidade:** MEDIO

### TC-02.8: detectHarnesses() returns correct structure
**Arquivo:** `src/harness/detector.js:53-63`
**Propósito:** Verificar que detectHarnesses retorna objetos com os campos esperados
**Comando:** `node -e "import('./src/harness/detector.js').then(m => { const h = m.detectHarnesses(); h.forEach(harness => console.log(harness.id, harness.label)) })"`
**Esperado:** Cada harness tem `id`, `label`, `configDir`, `configFile`
**Criticidade:** MEDIO

---

## TC-03: Install Flow (14 testes)
_Testa o fluxo completo de install.js_

### TC-03.1: Dry run — install mostra diagnóstico e "Tudo pronto"
**Setup:** Todos os 3 harnesses já instalados com gstack_vibehard (qg.py, ultracode.md, opencode.json contém "gstack_vibehard")
**Comando:** `echo "" | node src/index.js install 2>&1`
**Esperado:**
- Mostra "Diagnostico:" com cada harness marcado como "ja instalado (pulado)"
- Mostra "Tudo ja instalado. Nada a fazer."
- Exit sem erros
**Criticidade:** ALTO

### TC-03.2: Install com 1 harness disponivel
**Setup:** Remover `~/.codex/hooks/qg.py` temporariamente. Claude e OpenCode já instalados
**Comando:** `echo "1" | node src/index.js install 2>&1`
**Esperado:**
- "OpenAI Codex CLI — disponivel"
- Seleciona codex
- "codex configurado"
**Pós-teste:** Restaurar qg.py
**Criticidade:** ALTO

### TC-03.3: Install — "Nenhum harness detectado"
**Setup:** Nenhum harness no sistema (máquina limpa)
**Comando:** `node src/index.js install 2>&1`
**Esperado:**
- "Nenhum harness detectado."
- Lista instruções de instalação
- `process.exit(1)`
**Criticidade:** MEDIO

### TC-03.4: Install — selecao vazia cancela
**Setup:** Pelo menos 1 harness disponivel. Input vazio (Enter) no multiSelect
**Comando:** `echo "" | node src/index.js install 2>&1`
**Esperado:** Se "Todos detectados" é o default, ele prossegue. Se não houver default, "Nenhum harness selecionado. Instalacao cancelada."
**Criticidade:** MEDIO

### TC-03.5: gbrain install (ja instalado)
**Setup:** `gbrain --version` funciona (gbrain já instalado)
**Comando:** `echo "1" | node src/index.js install 2>&1` (com 1 harness disponivel)
**Esperado:** `✓ gbrain (bun global)` — deve ser rápido pois já está instalado (bun atualiza)
**Criticidade:** MEDIO

### TC-03.6: uv auto-install e graphify
**Setup:** `uv` NÃO instalado (remover do PATH temporariamente)
**Comando:** `echo "1" | node src/index.js install 2>&1` (com 1 harness disponivel)
**Esperado:**
- "uv: nao encontrado. Instalando..."
- `✓ uv instalado`
- `✓ graphify (uv tool)`
**Pós-teste:** Restaurar PATH
**Criticidade:** ALTO

### TC-03.7: Playwright chromium install
**Setup:** Cache do Playwright removido (`rm -rf ~/.cache/ms-playwright` no Linux, `rm -rf ~/AppData/Local/ms-playwright` no Windows)
**Comando:** `echo "1" | node src/index.js install 2>&1` (com 1 harness disponivel)
**Esperado:** `✓ Playwright: chromium instalado`
**Pós-teste:** Pode manter ou restaurar
**Criticidade:** ALTO

### TC-03.8: Scripts copiados para ~/.agents/scripts/
**Propósito:** 5 arquivos .ps1 devem estar em ~/.agents/scripts/
**Comando:** `ls ~/.agents/scripts/*.ps1 2>&1 | wc -l`
**Esperado:** Pelo menos 5 arquivos `.ps1`
**Criticidade:** MEDIO

### TC-03.9: Hooks copiados para ~/.codex/hooks/
**Propósito:** 8 arquivos .py devem estar em ~/.codex/hooks/
**Comando:** `ls ~/.codex/hooks/*.py 2>&1 | wc -l`
**Esperado:** 8 arquivos `.py`
**Criticidade:** ALTO

### TC-03.10: Skills copiadas (non-destructive)
**Propósito:** Skills são copiadas apenas se não existirem. Já existentes são puladas
**Comando:** `ls ~/.agents/skills/ 2>&1 | wc -l`
**Esperado:** Pelo menos 100 skills (o projeto tem ~107). Verificar relatório de "Pulados (ja existem)"
**Criticidade:** MEDIO

### TC-03.11: Install nao quebra se pasta de scripts nao existe
**Arquivo:** `src/installer/install.js:89-100`
**Setup:** Remover `scripts/scripts/` do projeto (temporariamente)
**Comando:** `echo "1" | node src/index.js install 2>&1`
**Esperado:** `⚠ scripts/scripts/ nao encontrado no pacote` — não crasha
**Pós-teste:** Restaurar scripts/scripts/
**Criticidade:** MEDIO

### TC-03.12: Install nao quebra se pasta de hooks nao existe
**Setup:** Remover `hooks/hooks/` do projeto (temporariamente)
**Esperado:** `⚠ hooks/hooks/ nao encontrado no pacote` — não crasha
**Pós-teste:** Restaurar hooks/hooks/
**Criticidade:** MEDIO

### TC-03.13: Report mostra added/updated/skipped/errors
**Propósito:** Após install, o relatório final deve listar tudo que foi adicionado, atualizado, pulado e erros
**Comando:** `echo "1" | node src/index.js install 2>&1 | tail -60`
**Esperado:** Seções "Adicionados:", "Atualizados:", "Pulados (ja existem):", "Erros:" (se houver)
**Criticidade:** BAIXO

### TC-03.14: Launcher Windows copiado (no Windows)
**Setup:** Executar em Windows
**Comando:** `echo "1" | node src/index.js install 2>&1`
**Esperado:** `✓ Launcher Windows copiado para ~/gstack_vibehard-install.bat`
**Criticidade:** BAIXO (só Windows)

---

## TC-04: Config Generation (12 testes)
_Testa codex.js, claude.js, opencode.js_

### TC-04.1: codex.js — TOML valido apos install
**Setup:** Executar install com codex selecionado
**Comando:** `python -c "import tomllib; tomllib.load(open(r'$env:USERPROFILE/.codex/config.toml', 'rb')); print('TOML valido')"` (Linux/Mac) ou use parser TOML equivalente
**Esperado:** "TOML valido" — sem erros de parsing
**Criticidade:** CRITICO — Bug já encontrado anteriormente

### TC-04.2: codex.js — paths com forward slashes
**Setup:** Config recém-gerado pelo install
**Comando:** Verificar `~/.codex/config.toml` contém `C:/Users/...` (forward slash) e não `C:\Users\...` (backslash)
**Esperado:** Todos os paths usam `/`
**Criticidade:** CRITICO

### TC-04.3: codex.js — hooks configurados no TOML
**Setup:** Config recém-gerado
**Comando:** `grep 'on_session_start\|on_stop\|pre_tool_use\|post_tool_use' ~/.codex/config.toml`
**Esperado:** 4 hooks configurados
**Criticidade:** ALTO

### TC-04.4: codex.js — MCP fallow configurado
**Setup:** Config recém-gerado
**Comando:** `grep 'fallow' ~/.codex/config.toml`
**Esperado:** `[mcp_servers.fallow]` presente
**Criticidade:** ALTO

### TC-04.5: claude.js — .mcp.json gerado com 6 servers
**Setup:** Executar install com claude selecionado
**Comando:** `node -e "const m = require('$env:USERPROFILE/.mcp.json'); console.log(Object.keys(m.mcpServers).length)"`
**Esperado:** 6 MCP servers (fallow, supabase, playwright, context7, gbrain, graphify)
**Criticidade:** ALTO

### TC-04.6: claude.js — .mcp.json merge com config existente
**Setup:** Criar `.mcp.json` com um server custom antes do install
**Comando:**
```json
// Pre-install: .mcp.json com server custom
{"mcpServers":{"custom-server":{"command":"echo","args":["hi"]}}}
// Rodar install com claude
// Verificar pos-install: server custom ainda existe
node -e "const m = require('$env:USERPROFILE/.mcp.json'); console.log(m.mcpServers['custom-server'] ? 'custom preservado' : 'custom PERDEU')"
```
**Esperado:** "custom preservado" — merge não destrutivo
**Criticidade:** ALTO

### TC-04.7: claude.js — .mcp.json backup criado
**Propósito:** Se já existia .mcp.json, um backup .bak deve existir
**Comando:** `ls -la ~/.mcp.json.gstack_vibehard.bak 2>&1`
**Esperado:** Arquivo existe
**Criticidade:** MEDIO

### TC-04.8: opencode.js — JSON valido
**Setup:** Executar install com opencode selecionado
**Comando:** `node -e "JSON.parse(require('fs').readFileSync('$env:USERPROFILE/.config/opencode/opencode.json'))"`
**Esperado:** JSON valido, sem erro
**Criticidade:** ALTO

### TC-04.9: opencode.js — contem "gstack_vibehard"
**Setup:** Config recém-gerado
**Comando:** `grep 'gstack_vibehard' ~/.config/opencode/opencode.json`
**Esperado:** String "gstack_vibehard" presente (usa como marker para checkAlreadyInstalled)
**Criticidade:** CRITICO — check.js depende disso

### TC-04.10: opencode.js — merge com plugins existentes
**Setup:** Criar opencode.json com plugins custom antes do install
**Comando:**
```json
// Pre-install
{"plugins":[{"name":"meu-plugin","skills":["skill-x"]}]}
// Rodar install
// Verificar pos-install: plugin custom ainda existe
node -e "const c = JSON.parse(require('fs').readFileSync('$env:USERPROFILE/.config/opencode/opencode.json')); console.log(c.plugins.find(p => p.name === 'meu-plugin') ? 'custom preservado' : 'custom PERDEU')"
```
**Esperado:** "custom preservado"
**Criticidade:** ALTO

### TC-04.11: Todos MCP servers usam comandos validos
**Arquivo:** `src/harness/claude.js:75-106`
**Propósito:** Verificar que todos os comandos MCP existem como pacotes npm ou binários no sistema
**Comando:** Para cada server, verificar:
- `npx -y fallow mcp` → fallow existe no npm
- `npx -y @playwright/mcp` → @playwright/mcp existe
- `gbrain serve` → gbrain global
- etc
**Criticidade:** MEDIO

### TC-04.12: codex.js — hook permission_request.py NÃO está no TOML
**Arquivo:** `src/harness/codex.js:31-36`
**Propósito:** `permission_request.py` é um hook que DEVE ser executado ANTES de ferramentas, mas está listado como hook opcional. Verificar se está configurado
**Comando:** `grep 'permission_request' ~/.codex/config.toml`
**Esperado:** Deve aparecer em alguma seção (pre_tool_use ou similar)
**Criticidade:** MEDIO

---

## TC-05: Doctor (10 testes)
_Testa src/installer/doctor.js_

### TC-05.1: Doctor mostra Node.js e Python
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:**
- `✓ Node.js: v24.x.x`
- `✓ Python: Python 3.x.x`
**Criticidade:** BAIXO

### TC-05.2: Doctor mostra todos os harnesses
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:**
- `✓ Codex CLI — detectado`
- `✓ Claude Code — detectado`
- `✓ OpenCode CLI — detectado`
**Criticidade:** ALTO

### TC-05.3: Doctor mostra gstack_vibehard instalado
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:** `✓ gstack_vibehard instalado: codex, claude, opencode`
**Criticidade:** ALTO

### TC-05.4: Doctor mostra hooks count
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:** `✓ 8 hooks Python instalados`
**Criticidade:** MEDIO

### TC-05.5: Doctor mostra skills count
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:** `✓ 107 skills instaladas` (ou número atual)
**Criticidade:** MEDIO

### TC-05.6: Doctor mostra chronicle sessions
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:** `✓ Chronicle: X sessoes registradas`
**Criticidade:** BAIXO

### TC-05.7: Doctor mostra gbrain + graphify status
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:**
- gbrain: OK
- graphify: OK (se instalado) ou `⚠` (se não instalado)
**Criticidade:** MEDIO

### TC-05.8: Doctor mostra Playwright status
**Setup:** Playwright chromium instalado
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:** `✓ Playwright: chromium instalado (chromium-XXXX)`
**Criticidade:** MEDIO

### TC-05.9: Doctor mostra .mcp.json status
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:** `✓ .mcp.json presente`
**Criticidade:** BAIXO

### TC-05.10: Doctor sem gstack_vibehard instalado
**Setup:** Remover hooks/qg.py, ultracode.md, e "gstack_vibehard" de opencode.json temporariamente
**Comando:** `node src/index.js doctor 2>&1`
**Esperado:** `gstack_vibehard: nao instalado em nenhum harness`
**Pós-teste:** Restaurar tudo
**Criticidade:** MEDIO

---

## TC-06: Init Command (12 testes)
_Testa src/commands/init.js_

### TC-06.1: Init sem argumento — erro
**Comando:** `node src/index.js init 2>&1`
**Esperado:** `✗ Uso: gstack_vibehard init <nome-do-projeto> --variant express|fastify|hono`
**Criticidade:** ALTO

### TC-06.2: Init em diretorio que ja existe — erro
**Setup:** Criar diretorio `test-project` primeiro
**Comando:** `mkdir test-project; node src/index.js init test-project 2>&1`
**Esperado:** `✗ Diretorio 'test-project' ja existe.`
**Pós-teste:** `rm -rf test-project`
**Criticidade:** ALTO

### TC-06.3: Init com variante valida (express)
**Comando:** `node src/index.js init test-project --variant express 2>&1`
**Esperado:**
- Cria diretorio
- `.context7/ criado`
- `.gstack/ criado`
- `.gbrain/ criado`
- `.graphify/ criado`
- `scripts/ criado`
- `Template fullstack copiado para test-project/`
- `✓ Projeto 'test-project' criado com sucesso!`
**Pós-teste:** `rm -rf test-project`
**Criticidade:** ALTO

### TC-06.4: Init com variante invalida — erro
**Comando:** `node src/index.js init test-project --variant invalid 2>&1`
**Esperado:** `✗ Variante invalida. Use: express, fastify, ou hono`
**Criticidade:** MEDIO

### TC-06.5: Init com variante fastify
**Comando:** `node src/index.js init test-project --variant fastify 2>&1`
**Esperado:** Cria projeto com fastify config
**Pós-teste:** `rm -rf test-project`
**Criticidade:** MEDIO

### TC-06.6: Init com variante hono
**Comando:** `node src/index.js init test-project --variant hono 2>&1`
**Esperado:** Cria projeto com hono + turso config
**Pós-teste:** `rm -rf test-project`
**Criticidade:** MEDIO

### TC-06.7: Init — .context7/stack.json valido
**Setup:** Init executado com sucesso
**Comando:** `node -e "const s = require('./test-project/.context7/stack.json'); console.log(s.project, s.frontend.framework, s.backend.framework)"`
**Esperado:** Mostra nome do projeto, "react 19", "express 5" (ou fastify/hono)
**Pós-teste:** `rm -rf test-project`
**Criticidade:** MEDIO

### TC-06.8: Init — .gstack/config.json valido
**Setup:** Init executado com sucesso
**Comando:** `node -e "const c = require('./test-project/.gstack/config.json'); console.log(c.project, c.variant, c.tools.join(', '))"`
**Esperado:** Mostra nome, variant, e lista de ferramentas
**Criticidade:** MEDIO

### TC-06.9: Init — .gbrain/context.json valido
**Setup:** Init executado com sucesso
**Comando:** `node -e "const c = require('./test-project/.gbrain/context.json'); console.log(c.project, c.createdAt)"`
**Esperado:** Mostra nome do projeto e data de criação
**Criticidade:** BAIXO

### TC-06.10: Init — .graphify/deps.json valido
**Setup:** Init executado com sucesso
**Comando:** `node -e "const g = require('./test-project/.graphify/deps.json'); console.log(g.nodes.length + ' nodes, ' + g.edges.length + ' edges')"`
**Esperado:** "4 nodes, 4 edges"
**Criticidade:** BAIXO

### TC-06.11: Init — scripts/run.ps1 criado
**Setup:** Init executado com sucesso
**Comando:** `head -3 test-project/scripts/run.ps1`
**Esperado:** PowerShell script header com parametros dev/build/db/deploy
**Pós-teste:** `rm -rf test-project`
**Criticidade:** BAIXO

### TC-06.12: Init — template copiado (apps/web existe)
**Setup:** Init executado com sucesso
**Comando:** `ls test-project/apps/web/ 2>&1`
**Esperado:** Diretorio com package.json, src/, etc
**Pós-teste:** `rm -rf test-project`
**Criticidade:** ALTO — template vazio = init quebrado

---

## TC-07: Merge Engine (8 testes)
_Testa src/installer/merge.js_

### TC-07.1: backupFile cria .bak apenas uma vez
**Arquivo:** `src/installer/merge.js:12-18`
**Setup:** Criar um arquivo temporário
**Comando:**
```bash
echo "original" > /tmp/test-merge.txt
node -e "import('./src/installer/merge.js').then(m => { m.backupFile('/tmp/test-merge.txt'); m.backupFile('/tmp/test-merge.txt'); console.log('OK') })"
ls /tmp/test-merge.txt.gstack_vibehard.bak 2>&1
```
**Esperado:** Apenas 1 arquivo .bak (não duplica)
**Criticidade:** MEDIO

### TC-07.2: writeWithBackup cria arquivo + backup
**Arquivo:** `src/installer/merge.js:65-69`
**Setup:** Escrever em arquivo existente
**Comando:**
```bash
echo "original" > /tmp/test-wwb.txt
node -e "import('./src/installer/merge.js').then(m => { m.writeWithBackup('/tmp/test-wwb.txt', 'novo'); console.log(require('fs').readFileSync('/tmp/test-wwb.txt','utf-8')) })"
```
**Esperado:** Conteúdo = "novo" + backup existe
**Criticidade:** MEDIO

### TC-07.3: mergeJson deep merge de objetos
**Arquivo:** `src/installer/merge.js:27-48`
**Propósito:** Objetos aninhados devem ser merged (não substituídos)
**Comando:**
```bash
node -e "
import('./src/installer/merge.js').then(m => {
  const existing = { a: { x: 1, y: 2 }, b: 3 }
  const gv = { a: { z: 4 }, c: 5 }
  const r = m.mergeJson(existing, gv)
  console.log(JSON.stringify(r))
})"
```
**Esperado:** `{"a":{"x":1,"y":2,"z":4},"b":3,"c":5}` — merge profundo, não substituição
**Criticidade:** ALTO

### TC-07.4: mergeJson array dedup
**Arquivo:** `src/installer/merge.js:32-37`
**Propósito:** Arrays não devem duplicar itens
**Comando:**
```bash
node -e "
import('./src/installer/merge.js').then(m => {
  const existing = { skills: ['a', 'b'] }
  const gv = { skills: ['b', 'c'] }
  const r = m.mergeJson(existing, gv)
  console.log(JSON.stringify(r))
})"
```
**Esperado:** `{"skills":["a","b","c"]}` — 'b' não duplicado
**Criticidade:** ALTO

### TC-07.5: mergeJson user priority on conflict
**Arquivo:** `src/installer/merge.js:40`
**Propósito:** Se usuário já tem uma config e gstack tenta sobrescrever, a config do usuário deve prevalecer
**Comando:**
```bash
node -e "
import('./src/installer/merge.js').then(m => {
  const user = { theme: 'dark', port: 4000 }
  const gv = { port: 3000, newField: true }
  const r = m.mergeJson(user, gv)
  console.log(JSON.stringify(r))
})"
```
**Esperado:** `{"theme":"dark","port":4000,"newField":true}` — port 4000 do usuario prevalece
**Criticidade:** ALTO

### TC-07.6: mergeJson com input null
**Arquivo:** `src/installer/merge.js:28`
**Propósito:** Se existing for null/undefined, retorna gvConfig
**Comando:**
```bash
node -e "
import('./src/installer/merge.js').then(m => {
  console.log(JSON.stringify(m.mergeJson(null, {a:1})))
  console.log(JSON.stringify(m.mergeJson(undefined, {a:1})))
})"
```
**Esperado:** Ambos retornam `{"a":1}`
**Criticidade:** MEDIO

### TC-07.7: ensureDir cria recursivamente
**Arquivo:** `src/installer/merge.js:21-24`
**Setup:** Path com múltiplos níveis
**Comando:**
```bash
node -e "import('./src/installer/merge.js').then(m => { m.ensureDir('/tmp/a/b/c/d/e'); console.log(require('fs').existsSync('/tmp/a/b/c/d/e') ? 'OK' : 'FAIL') })"
rm -rf /tmp/a
```
**Esperado:** "OK" — diretório criado recursivamente
**Criticidade:** MEDIO

### TC-07.8: mergeArray com marker
**Arquivo:** `src/installer/merge.js:50-63`
**Propósito:** mergeArray deve adicionar marker string se especificado
**Comando:**
```bash
node -e "
import('./src/installer/merge.js').then(m => {
  const r = m.mergeArray(['a', 'b'], ['c'], '# GStack: test')
  console.log(r.join(', '))
})"
```
**Esperado:** Inclui "a, b, c" e o marker "# GStack: test"
**Criticidade:** BAIXO

---

## TC-08: Cross-Platform (10 testes)
_Testes específicos para cada sistema operacional_

### TC-08.1: Windows — Launcher .bat funciona
**Arquivo:** `launchers/windows/install.bat`
**Propósito:** .bat deve verificar node e executar npx
**Setup:** Ter node no PATH
**Comando:** `launchers\windows\install.bat doctor 2>&1`
**Esperado:** Executa `gstack_vibehard doctor` via npx
**Criticidade:** ALTO (Windows)

### TC-08.2: Windows — .ps1 scripts usam sintaxe PowerShell
**Arquivo:** Todos os `scripts/scripts/*.ps1`
**Propósito:** Scripts .ps1 não podem conter sintaxe bash
**Comando:** `PowerShell -NoProfile -Command "Get-ChildItem scripts/scripts/*.ps1 | ForEach-Object { try { $null = [System.Management.Automation.PSParser]::Tokenize((Get-Content $_.FullName), [ref]$null); Write-Output \"$($_.Name): OK\" } catch { Write-Output \"$($_.Name): SYNTAX ERROR: $_\" } }"`
**Esperado:** Todos os scripts retornam "OK"
**Criticidade:** ALTO (Windows)

### TC-08.3: macOS — Homebrew formula sintaxe valida
**Arquivo:** `launchers/macos/gstack_vibehard.rb`
**Setup:** Ruby instalado
**Comando:** `ruby -c launchers/macos/gstack_vibehard.rb 2>&1`
**Esperado:** "Syntax OK"
**Criticidade:** ALTO (macOS)

### TC-08.4: Linux — install.sh sintaxe valida
**Arquivo:** `launchers/cross/install.sh`
**Setup:** Bash instalado
**Comando:** `bash -n launchers/cross/install.sh 2>&1`
**Esperado:** Sem erro de sintaxe
**Criticidade:** ALTO (Linux)

### TC-08.5: install.sh tem permissao de execucao
**Arquivo:** `launchers/cross/install.sh`
**Comando:** `ls -la launchers/cross/install.sh | cut -d' ' -f1`
**Esperado:** Deve ter `x` (ex: `-rwxr-xr-x`)
**Criticidade:** MEDIO (Linux)

### TC-08.6: Path separators — nenhum caminho hardcoded com \
**Arquivo: Todos os .js em src/**
**Propósito:** Em um projeto cross-platform, paths com `\` quebram no Linux/Mac
**Comando:** `grep -rn "'C:\\\\\|'C:/" src/ --include='*.js'` (caminhos hardcoded)
**Esperado:** Nenhum path hardcoded com `C:\` ou `C:/`
**Criticidade:** ALTO

### TC-08.7: MOM apenas macOS
**Arquivo:** `src/installer/install.js`
**Propósito:** MOM só deve ser instalado no macOS (brew)
**Comando:** Verificar código: há `if (isMacOS())` antes de `brew install mom`?
**Esperado:** Sim, há guard condicional
**Criticidade:** MEDIO

### TC-08.8: Windows — powershell -c usado para uv install
**Arquivo:** `src/installer/install.js:127`
**Propósito:** No Windows, uv deve ser instalado via powershell, não curl
**Comando:** `grep -A2 "isWindows()" src/installer/install.js | head -5`
**Esperado:** `'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'`
**Criticidade:** ALTO

### TC-08.9: Linux — curl usado para uv install
**Arquivo:** `src/installer/install.js:129`
**Propósito:** No Linux, uv deve ser instalado via curl/sh
**Comando:** `grep -A2 "isLinux\|else" src/installer/install.js | grep "curl"`
**Esperado:** `'curl -LsSf https://astral.sh/uv/install.sh | sh'`
**Criticidade:** ALTO

### TC-08.10: Hardcoded /Users/ ou /home/ paths
**Arquivo:** Todos os .js
**Propósito:** Nenhum path deve assumir home fixo. Usar sempre `homedir()` ou `$HOME`
**Comando:** `grep -rn '/Users/\|/home/' src/ --include='*.js'`
**Esperado:** Nenhum resultado
**Criticidade:** ALTO

---

## TC-09: Edge Cases (10 testes)
_Testes de borda, falhas, situacoes inesperadas_

### TC-09.1: Sem internet — deps instalam com warning
**Setup:** Desconectar internet (airplane mode)
**Comando:** `echo "1" | node src/index.js install 2>&1`
**Esperado:** Cada dep falha com `⚠` warning mas o install continua (não crasha)
**Criticidade:** MEDIO

### TC-09.2: Sem npm — version check no init falha silencioso
**Setup:** npm não disponível (remover temporariamente)
**Comando:** `node src/index.js init test-project --variant express 2>&1`
**Esperado:** Init funciona sem o version check (try/catch silencia o erro)
**Criticidade:** BAIXO

### TC-09.3: Interrupcao no meio do install — backup existe
**Setup:** Matar o processo no meio do install (Ctrl+C)
**Comando:** Iniciar install e matar após 2 segundos
**Esperado:** Arquivos já copiados têm `.gstack_vibehard.bak`
**Criticidade:** BAIXO

### TC-09.4: .mcp.json corrompido (JSON invalido)
**Setup:** Escrever JSON invalido em ~/.mcp.json
**Comando:**
```bash
echo "not json" > ~/.mcp.json
echo "1" | node src/index.js install 2>&1
```
**Esperado:** merge.js trata o erro (readJsonFile retorna null) e recria o arquivo
**Pós-teste:** Restaurar .mcp.json original
**Criticidade:** ALTO

### TC-09.5: Permissao negada em ~/.codex/hooks/
**Setup:** Remover permissão de escrita de ~/.codex/hooks/ (chmod -w)
**Comando:** `chmod -w ~/.codex/hooks/; echo "1" | node src/index.js install 2>&1`
**Esperado:** Erro tratado com try/catch, não crasha
**Pós-teste:** `chmod +w ~/.codex/hooks/`
**Criticidade:** MEDIO

### TC-09.6: Diretorio .agents/nao existe (primeira execucao)
**Setup:** Renomear ~/.agents/ temporariamente
**Comando:** `mv ~/.agents ~/.agents.bak; echo "1" | node src/index.js install 2>&1`
**Esperado:** ensureDir cria o diretorio. Install funciona normalmente
**Pós-teste:** `rm -rf ~/.agents; mv ~/.agents.bak ~/.agents`
**Criticidade:** MEDIO

### TC-09.7: Re-install apos install completo
**Setup:** Install completo já executado
**Comando:** `echo "1" | node src/index.js install 2>&1`
**Esperado:** "Tudo ja instalado. Nada a fazer."
**Criticidade:** ALTO

### TC-09.8: Comando desconhecido no CLI
**Comando:** `node src/index.js foo bar 2>&1`
**Esperado:** `✗ Comando desconhecido: foo` + help exibido
**Criticidade:** BAIXO

### TC-09.9: Init com nome de projeto contendo espacos
**Comando:** `node src/index.js init "meu projeto" --variant express 2>&1`
**Esperado:** Deve criar o diretorio com espaco ou rejeitar com erro explicativo
**Pós-teste:** `rm -rf "meu projeto"`
**Criticidade:** BAIXO

### TC-09.10: CLAUDE.md com conteudo do usuario — backup deve existir
**Setup:** Criar CLAUDE.md com conteudo do usuario
**Comando:**
```bash
echo "# Meu projeto" > ~/CLAUDE.md
echo "1" | node src/index.js install 2>&1
ls -la ~/CLAUDE.md.gstack_vibehard.bak 2>&1
```
**Esperado:** Backup existe com o conteudo original
**Criticidade:** ALTO

---

## TC-10: Launchers + Licenses + Sprint (6 testes)
_Verificacoes finais para lancamento_

### TC-10.1: install.bat — verifica node antes de executar
**Arquivo:** `launchers/windows/install.bat:5-11`
**Propósito:** Se node não existir, deve mostrar erro amigável
**Setup:** Remover node do PATH (ou testar em maquina sem node)
**Comando:** `launchers\windows\install.bat` (sem node)
**Esperado:** `[gstack_vibehard] Node.js nao encontrado.` + link de download
**Criticidade:** MEDIO

### TC-10.2: install.bat — passa argumentos corretamente
**Arquivo:** `launchers/windows/install.bat:13-17`
**Propósito:** Argumentos devem ser passados para o npx
**Setup:** Ter node no PATH
**Comando:** `launchers\windows\install.bat doctor 2>&1`
**Esperado:** Executa `npx @gstack-vibehard/installer doctor`
**Criticidade:** MEDIO

### TC-10.3: Homebrew formula — class name e deps corretos
**Arquivo:** `launchers/macos/gstack_vibehard.rb`
**Propósito:** Formula deve ter classe nomeada, dependencias e post_install
**Comando:** `grep -E 'class |depends_on|post_install' launchers/macos/gstack_vibehard.rb`
**Esperado:**
- `class GstackVibehard`
- `depends_on` para node, bun, uv
- `def post_install` com gbrain + graphify
**Criticidade:** MEDIO

### TC-10.4: Licenses presentes e corretas
**Propósito:** Todos os arquivos de licenca devem existir
**Comando:**
```bash
# LICENSE na raiz (MIT)
head -3 LICENSE
# NOTICE
head -3 NOTICE
# highermind LICENSE preservado
head -3 kits/highermind-code-skills/highermind-code-skills/LICENSE
# frontend-design LICENSE preservado
head -3 skills/skills/frontend-design/LICENSE.txt
# package.json aponta pra MIT
grep license package.json
```
**Esperado:**
- `LICENSE` — MIT License
- `NOTICE` — Third-Party Components listados
- `kits/*/LICENSE` — Preservados
- `package.json` — `"license": "MIT"`
**Criticidade:** CRITICO — Sem licença, não pode publicar

### TC-10.5: .gitignore cobre .bak files
**Propósito:** Arquivos .bak não devem ir pro git
**Comando:** `grep '\.bak' .gitignore`
**Esperado:** `*.bak` ou `.gstack_vibehard.bak` no .gitignore
**Criticidade:** BAIXO

### TC-10.6: README.md minimamente informativo
**Arquivo:** `README.md`
**Propósito:** README deve explicar o que é o projeto, como instalar, como usar
**Comando:** `wc -l README.md`
**Esperado:** Pelo menos 20 linhas com instruções básicas
**Criticidade:** BAIXO

---

## TC-11: Post-Sprint e Memoria (8 testes)
_Testa hooks/hooks/post_sprint.py + src/commands/sprint.js_

### TC-11.1: post_sprint.py — script existe e executavel
**Arquivo:** `hooks/hooks/post_sprint.py`
**Propósito:** Verificar que o script existe e tem shebang valido
**Comando:** `head -1 hooks/hooks/post_sprint.py`
**Esperado:** `#!/usr/bin/env python3`
**Criticidade:** ALTO

### TC-11.2: post_sprint.py — graphify update cria .graphify/deps.json
**Setup:** Diretorio com apps/ e packages/
**Comando:**
```bash
mkdir -p /tmp/test-sprint/apps/web /tmp/test-sprint/packages/db
echo '{"dependencies":{"react":"^19"}}' > /tmp/test-sprint/apps/web/package.json
echo '{"dependencies":{"drizzle-orm":"^0.30"}}' > /tmp/test-sprint/packages/db/package.json
echo '{"cwd":"/tmp/test-sprint","last_assistant_message":"Decisao: Vamos usar React 19"}' | python hooks/hooks/post_sprint.py
cat /tmp/test-sprint/.graphify/deps.json | head -5
```
**Esperado:** .graphify/deps.json criado com nodes e edges
**Pós-teste:** `rm -rf /tmp/test-sprint`
**Criticidade:** ALTO

### TC-11.3: post_sprint.py — gbrain update extrai decisoes
**Setup:** Continuação do teste anterior
**Comando:**
```bash
cat /tmp/test-sprint/.gbrain/context.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8'); const j=JSON.parse(d); console.log(j.decisions.length + ' decisoes')"
```
**Esperado:** Pelo menos 1 decisao extraida do texto "Decisao: Vamos usar React 19"
**Criticidade:** ALTO

### TC-11.4: post_sprint.py — chronicle enrich adiciona decisoes
**Setup:** Criar um chronicle file falso
**Comando:**
```bash
mkdir -p ~/.codex/chronicle
echo "# Session: test-sprint\n## Summary\nteste" > ~/.codex/chronicle/test-sprint_20260101_000000.md
echo '{"cwd":"/tmp/test-sprint","last_assistant_message":"Decisao: Usar vite"}' | python hooks/hooks/post_sprint.py
grep 'Decisoes do Sprint' ~/.codex/chronicle/test-sprint_20260101_000000.md
```
**Esperado:** "## Decisoes do Sprint" adicionado ao chronicle
**Pós-teste:** `rm ~/.codex/chronicle/test-sprint_20260101_000000.md; rm -rf /tmp/test-sprint`
**Criticidade:** MEDIO

### TC-11.5: sprint.js — comando gstack_vibehard sprint --save existe
**Arquivo:** `src/commands/sprint.js`
**Propósito:** O comando deve ser registrado no CLI
**Comando:** `node src/index.js sprint --help 2>&1` ou `node src/index.js sprint 2>&1`
**Esperado:** Mostra "Uso: gstack_vibehard sprint --save" com descricao
**Criticidade:** MEDIO

### TC-11.6: stop.py — chama post_sprint.py ao final
**Arquivo:** `hooks/hooks/stop.py`
**Propósito:** Verificar que stop.py invoca post_sprint.py via subprocess
**Comando:** `grep -n 'post_sprint' hooks/hooks/stop.py`
**Esperado:** Pelo menos uma referencia a post_sprint.py (subprocess.run)
**Criticidade:** ALTO

### TC-11.7: post_sprint.py — MOM record apenas macOS
**Arquivo:** `hooks/hooks/post_sprint.py`
**Propósito:** Verificar que MOM so executa em macOS
**Comando:** `grep -n 'darwin\|sys.platform' hooks/hooks/post_sprint.py`
**Esperado:** `sys.platform != "darwin"` — guard condicional
**Criticidade:** BAIXO

### TC-11.8: orchestrator.md — instrucao de finalizacao de sprint
**Arquivo:** `agents/agents/orchestrator.md`
**Propósito:** O orquestrador deve instruir a chamada de `gstack_vibehard sprint --save` ao final de cada fase
**Comando:** `grep -c 'sprint --save' agents/agents/orchestrator.md`
**Esperado:** Pelo menos 1 ocorrencia de `sprint --save`
**Criticidade:** MEDIO

---

## TC-12: Headroom Integration (8 testes)
_Testa src/harness/headroom.js + install + doctor_

### TC-12.1: headroom.js — arquivo existe e exporta installHeadroom
**Arquivo:** `src/harness/headroom.js`
**Propósito:** O harness headroom deve existir e exportar a funcao
**Comando:** `node -e "import('./src/harness/headroom.js').then(m => console.log(typeof m.installHeadroom))"`
**Esperado:** "function"
**Criticidade:** ALTO

### TC-12.2: install.js — importa e chama installHeadroom
**Arquivo:** `src/installer/install.js`
**Propósito:** O install deve importar e chamar installHeadroom
**Comando:** `grep -c 'installHeadroom' src/installer/install.js`
**Esperado:** Pelo menos 2 ocorrencias (import + chamada)
**Criticidade:** ALTO

### TC-12.3: doctor.js — verifica headroom --version
**Arquivo:** `src/installer/doctor.js`
**Propósito:** Doctor deve reportar headroom
**Comando:** `grep -c 'headroom' src/installer/doctor.js`
**Esperado:** Pelo menos 2 ocorrencias (check + output)
**Criticidade:** MEDIO

### TC-12.4: check.js — exporta isHeadroomInstalled
**Arquivo:** `src/installer/check.js`
**Propósito:** check.js deve exportar funcao para detectar headroom
**Comando:** `grep -c 'isHeadroomInstalled' src/installer/check.js`
**Esperado:** Pelo menos 1 ocorrencia
**Criticidade:** BAIXO

### TC-12.5: init.js — headroom na lista de tools
**Arquivo:** `src/commands/init.js`
**Propósito:** O init deve incluir headroom nos tools do .gstack/config.json
**Comando:** `grep -c '"headroom"' src/commands/init.js`
**Esperado:** Pelo menos 1 ocorrencia
**Criticidade:** BAIXO

### TC-12.6: claude.js — headroom MCP server configurado
**Arquivo:** `src/harness/claude.js`
**Propósito:** O MCP config do Claude deve incluir headroom server
**Comando:** `grep -c 'headroom' src/harness/claude.js`
**Esperado:** Pelo menos 1 ocorrencia de comand/args headroom
**Criticidade:** MEDIO

### TC-12.7: NOTICE — headroom-ai listado como third-party
**Arquivo:** `NOTICE`
**Propósito:** headroom-ai deve estar no NOTICE com licenca Apache 2.0
**Comando:** `grep -c 'headroom-ai' NOTICE`
**Esperado:** Pelo menos 1 ocorrencia
**Criticidade:** BAIXO

### TC-12.8: install.js — headroom instalado via pip/uv pip
**Arquivo:** `src/installer/install.js`
**Propósito:** headroom deve ser instalado com pip (preferencialmente uv pip)
**Comando:** `grep -c 'headroom-ai' src/installer/install.js`
**Esperado:** Pelo menos 1 referencia ao pacote headroom-ai
**Criticidade:** ALTO

---

## Relatorio Final

Apos executar todos os testes, preencha:

```
TESTESLLM.MD — Relatorio Final
===============================
Data: _______________
Executor: ____________

TC-01 Static Analysis:     ___/12 passaram
TC-02 Harness Detection:   ___/8 passaram
TC-03 Install Flow:        ___/14 passaram
TC-04 Config Generation:   ___/12 passaram
TC-05 Doctor:              ___/10 passaram
TC-06 Init Command:        ___/12 passaram
TC-07 Merge Engine:        ___/8 passaram
TC-08 Cross-Platform:      ___/10 passaram
TC-09 Edge Cases:          ___/10 passaram
TC-10 Launchers+Licenses:  ___/6 passaram
TC-11 Post-Sprint:          ___/8 passaram
TC-12 Headroom:            ___/8 passaram

TOTAL: ___/114 passaram

Bugs encontrados:
1. [descricao] — TC-XX.Y — CRITICO/ALTO/MEDIO/BAIXO
2. ...

Observacoes:
- ...
```
