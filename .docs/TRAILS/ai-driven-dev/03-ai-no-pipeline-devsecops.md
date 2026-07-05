# Aula 03 — AI no pipeline (DevSecOps)

> Trilha AI-Driven Dev · referência metodológica AIDD, **nunca** dependência runtime.
> **Ler esta trilha não instala nada.**

## Objetivo

Colocar gates entre o agente e o merge. Você aprende o caminho **execution** do GStack:
Quality Gate (QG) por severidade, `verify` por perfil, `audit` de segurança e
`publish-guard` antes de PR/merge. **O LLM nunca é o gate final.**

## Comandos GStack reais

```bash
gstack_vibehard verify --profile full --json   # roda o perfil de checks; JSON puro
gstack_vibehard audit                          # auditoria de segurança (OWASP-oriented)
gstack_vibehard qa                             # suíte de qualidade/testes
gstack_vibehard publish-guard                  # trava PR/merge se os gates não passarem
```

- `verify`, `audit`, `qa` viram evidência; `publish-guard` é o portão de saída.
- QG bloqueia em CRÍTICO/ALTO; MÉDIO/BAIXO é documentado e segue.

## Erros comuns

- Pedir merge sem `verify` verde — `publish-guard` recusa por design.
- Tratar "Fallow rodou" como "Fallow verde": leia o `verdict`, não só o exit.
- Silenciar findings de segurança em vez de corrigir a causa.

## Checklist

- [ ] `gstack_vibehard verify --dry-run` lista os checks do perfil sem executar.
- [ ] QG CRÍTICO/ALTO = 0 antes de qualquer entrega.
- [ ] `publish-guard` roda **depois** de `verify`, nunca antes.

## Exercício prático

Rode `gstack_vibehard verify --profile full --json` e conte quantos checks compõem o
perfil. Depois rode `gstack_vibehard audit` e classifique um finding por severidade.

## Como validar

```bash
gstack_vibehard verify --json && gstack_vibehard publish-guard
```

## Como desfazer / rollback

Esses comandos não editam código-fonte (produzem relatórios/decisões). Se um gate
bloqueou, corrija a causa e re-execute — não force o merge.
