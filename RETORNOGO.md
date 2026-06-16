# 🔙 RETORNOGO — Rede de Segurança da Integração Printing Press

Este arquivo existe para **voltar atrás com segurança** caso a integração Printing Press
(híbrida Composio nuvem + Printing Press local) cause falhas graves.

## Âncora de retorno (último estado bom e estável)
- **Branch estável:** `master`
- **Commit âncora:** `13185de` — `v2.2.4: release — revisao round-2`
- **Tag:** `v2.2.4`
- **npm publicado (latest):** `@gstack-vibehard/installer@2.2.4`
- **Estado:** 28 testes Node + 24 Python verdes; instalação base, hooks e `create` atestados.

## Onde o trabalho novo acontece
- **Branch de trabalho:** `feat/printing-press-hybrid` (NÃO mexe na `master` até verificação completa).
- Commits por PR (PR1→PR5). A `master` e o npm continuam intactos durante o desenvolvimento.

## Como voltar atrás

### 1. Falha ANTES do merge (caso mais comum — recomendado)
A `master` nunca foi tocada. Basta abandonar o branch:
```bash
git checkout master
git branch -D feat/printing-press-hybrid
```
`master` segue em `13185de` / v2.2.4. npm intacto. **Nada a desfazer.**

### 2. Falha DEPOIS do merge na master (antes de publicar)
```bash
git checkout master
git reset --hard 13185de        # volta master ao estado bom
git push --force-with-lease     # só se combinado; reescreve historico remoto
```
Alternativa não-destrutiva (preserva histórico):
```bash
git revert <sha-inicial-PP>..<sha-final-PP>
git push
```

### 3. Falha DEPOIS de publicar no npm
O npm **não permite unpublish** após 72h (e mesmo antes é disruptivo). Procedimento:
```bash
npm deprecate "@gstack-vibehard/installer@<versao-ruim>" "Versao com regressao — use 2.2.4 ou a proxima corrigida"
# corrigir, bumpar patch e publicar uma versao boa por cima
```
A âncora `2.2.4` continua instalável por quem fixar a versão.

## ✅ Checklist de "FALHA GRAVE" (dispara o retorno)
Voltar atrás se **qualquer** item ocorrer e não for corrigível rápido:
- [ ] `node src/index.js install` (base) quebra ou destrói config do usuário
- [ ] Hooks (Claude/Cursor/Codex/OpenCode) param de disparar
- [ ] `node src/index.js create` gera projeto que não roda
- [ ] `npm test` ou `npm run test:py` ficam vermelhos sem correção
- [ ] `tools` toca `.mcp.json`/config global sem o usuário pedir
- [ ] Algum segredo é escrito em disco

## Gate para merge na master (v2.3.0)
Só mergear quando **TODOS** verdes:
- `npm test` (Node) + `npm run test:py` (Python, com fallback unittest)
- E2E: `create … --lite` gera `integrations.json` correto; `tools suggested/list/search` ok; `doctor` não quebra
- Nenhum item do checklist de falha grave disparado
- `RETORNOGO.md` atualizado

## Status da integração Printing Press
- **PR1–PR5 concluídos**, 49 testes Node + 24 Python verdes, atestado E2E (create/tools/doctor) OK.
- Nova âncora **pós-merge:** `master` @ v2.3.0. Para reverter a integração e voltar à base anterior: `git reset --hard 13185de` (v2.2.4) ou `git revert` do range de PRs.
- Nenhum item do checklist de falha grave disparado no desenvolvimento.

---
_Mantido atualizado a cada PR. Não deletar até a v2.3.0 estar estável em produção._
