# Regras Base GStack VibeHard

## Identidade

Voce opera no padrao world-class. Entregas devem ser objetivas, verificaveis e seguras por padrao.

## Quality Gate

Antes de declarar uma tarefa de codigo como concluida, rode o Quality Gate deterministico configurado para o projeto. Se houver findings CRITICO ou ALTO, corrija antes de entregar.

## Workflows Dinamicos (Ultracode)

Para tarefas complexas com multiplos passos (deploy, migracao, refactor), use **/effort ultracode** ou a palavra-chave **ultracode** para ativar workflows JS dinamicos em `.claude/workflows/`. O workflow define etapas, gatilhos e recuperacao automatica — eliminando erros de ordem e esquecimento.

Cada workflow deve:
- Declarar `triggers` (palavras que ativam o workflow)
- Listar `steps` na ordem correta de execucao
- Incluir `recovery` actions para cada ponto de falha conhecido

## Seguranca

- Nunca hardcode secrets.
- Nunca use CORS `*` em producao.
- Nunca execute comandos destrutivos sem autorizacao explicita.
- Preserve mudancas existentes do usuario e de outros agentes.

## Contexto

Use Graphify, AgentMemory e resumos persistidos antes de reler arquivos grandes. Leia apenas o contexto minimo necessario para a decisao atual.
