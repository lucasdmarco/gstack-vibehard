---
name: split-to-prs
description: "Divide o trabalho atual em PRs pequenos e revisáveis. Use quando o usuário pedir para dividir um chat, conjunto de mudanças, branch, ou PR."
---

# Split to PRs

Transforma uma pilha de trabalho em PRs pequenos.

## Regras

- Não crie branches, commit, push, ou abra PRs até o usuário aprovar o plano
- Nunca descarte trabalho do usuário. Sem comandos git destrutivos (`reset --hard`, `clean -fdx`, force-push) sem aprovação
- Sempre salve snapshot recuperável antes de mover trabalho
- Stage apenas arquivos ou hunks nomeados. Sem `git add .`

## 1. Verificar Estado

Compare o trabalho atual com a branch default do repositório, incluindo mudanças commitadas e não-commitadas. Use o histórico do chat para recuperar intenção.

## 2. Propor Divisão

Use títulos de PR. Adicione escopo de uma linha só quando o título não for claro. Mostre diagrama Mermaid quando houver múltiplos slices.

Otimize para PRs alinhados por revisor com diff mínimo.

Peça aprovação antes de começar.

## 3. Executar Split

Salve snapshot recuperável:
```bash
SHA=$(git stash create "pre-split-$(date +%s)")
if [ -n "$SHA" ]; then
  git update-ref "refs/backup/pre-split-$(date +%s)" "$SHA"
fi
```

Para cada slice aprovado:
```bash
git checkout -b "feat/nome-do-slice"
git add <arquivos-planejados>
git commit -m "feat: descrição do slice"
git push -u origin HEAD
gh pr create --title "título" --body "descrição"
```

## 4. Relatar

Títulos e URLs dos PRs, mais o que ficou na branch original ou working tree. Não delete backup refs ou branches originais sem permissão.
