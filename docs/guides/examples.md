# Exemplos por intenção

Escolha pela sua **intenção**. Cada exemplo usa só comandos que existem no CLI
(garantido pelo `command-lint` na CI).

## "Quero começar do zero, guiado"

```
gstack_vibehard start
```

Fluxo completo Intent → Plan → Scout → Create → Dev → Test → Review → Verify. Pergunta
antes de executar. Ideal para quem não sabe por onde começar.

## "Quero só criar o esqueleto de um projeto"

```
gstack_vibehard create
```

Cria o scaffold (variante lite ou full). Não roda o pipeline guiado — é o atalho para
quem já sabe o que quer.

## "Quero ver rodando agora"

```
gstack_vibehard dev
```

Sobe o ambiente supervisionado com readiness. Te dá a URL quando está pronto.

## "Quero saber se está tudo íntegro antes de entregar"

```
gstack_vibehard verify
gstack_vibehard proof
```

`verify` roda os gates de release; `proof` consolida a prova (`ready: true`).

## "Quero consultar a base do projeto sem editar nada"

```
gstack_vibehard consult
gstack_vibehard context
```

Camada **knowledge**: read-only. Nunca toca no código-fonte.

## "Quero entender as skills e os gates"

```
gstack_vibehard skills catalog
gstack_vibehard skills gates show
gstack_vibehard skills why verify-proof-gate
```

Inventário determinístico, matriz de gates por fase, e a explicação de um gate.

## "Quero auditar uma skill de um repo externo (sem instalar nada)"

```
gstack_vibehard research skills audit --path ./mirror-local
```

Auditoria **read-only** (adopt/adapt/avoid). Nunca executa script externo, nunca
instala, nunca lê `.env`. Depois, se quiser trazer para o projeto:

```
gstack_vibehard skills vendor import --path ./mirror-local
```

Dry-run por padrão — mostra o plano sem escrever nada em `skills/`.

## "Quero remover tudo"

```
gstack_vibehard uninstall
```
