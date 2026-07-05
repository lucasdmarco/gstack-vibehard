# Aula 01 — A nova stack do desenvolvedor (AI-driven)

> Trilha AI-Driven Dev · inspirada em `lgsreal/ai-driven-dev` (referência metodológica,
> **nunca** dependência runtime — ver `.docs/RESEARCH/repository-registry.json`).
> **Ler esta trilha não instala nada.**

## Objetivo

Entender o modelo mental do desenvolvimento AI-driven: o agente é um **executor com
capacete**, não um oráculo. O GStack adiciona gates, worktree, provenance e rollback ao
redor do agente. Você sai desta aula sabendo diferenciar **knowledge** (consulta, sem
editar código) de **execution** (age só com gates).

## Comandos GStack reais

```bash
gstack_vibehard start            # first-run guiado e SEGURO; não instala nada por si só
gstack_vibehard doctor           # diagnóstico do ambiente (read-only)
gstack_vibehard context search "arquitetura" --json   # knowledge: consulta a base local
```

- `start`, `doctor`, `context` são **knowledge/read-only** (`src/meta/command-layers.js`).
- Nenhum deles edita código-fonte.

## Erros comuns

- Tratar o agente como fonte de verdade final — o **gate** (QG/`verify`) é a verdade.
- Rodar execução antes de indexar contexto: sempre `context index` primeiro.
- Confundir "callable" com "roteado" (ex.: Headroom é `callable_not_routed` até prova).

## Checklist

- [ ] `gstack_vibehard doctor` roda sem erro crítico.
- [ ] Você sabe dizer se um comando é knowledge ou execution.
- [ ] Entendeu que a trilha é documentação, não instalação.

## Exercício prático

Rode `gstack_vibehard context search "worktree" --json` e identifique de qual documento
veio a decisão. Depois classifique 3 comandos do CLI em knowledge vs execution.

## Como validar

```bash
gstack_vibehard verify --dry-run   # confirma que o ambiente passa os checks de leitura
```

## Como desfazer / rollback

Nada foi escrito por esta aula. Se você rodou `start` e quer reverter qualquer artefato:

```bash
gstack_vibehard uninstall --dry-run   # mostra o plano de remoção ANTES de qualquer ação
```
