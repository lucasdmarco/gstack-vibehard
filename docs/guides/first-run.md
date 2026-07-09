# Primeira vez com o gstack_vibehard

Este guia é para quem **nunca usou** a ferramenta. Sem jargão. Cada passo mostra o
que você digita e o que o produto responde. Nenhum segredo aparece aqui — o produto
nunca pede nem escreve suas chaves neste fluxo.

> Regra de ouro: o produto **pergunta antes de agir**. Ele nunca instala nada, nem
> escreve código, sem você confirmar.

## 1. Checar o ambiente

```
gstack_vibehard doctor
```

Ele verifica Node/npm/npx e diz, em português, se algo falta. Se você rodar isso na
sua pasta pessoal (`C:\Users\voce`) por engano, ele **não** manda instalar nada — ele
avisa que ali não é lugar de projeto e oferece criar/abrir/diagnosticar.

## 2. Começar um projeto guiado

```
gstack_vibehard start
```

O `start` conduz o fluxo inteiro: entende a intenção, planeja, e só executa **depois
que você aprova o plano**. No caminho ele pode perguntar coisas como:

- "Criar novo projeto, entrar em um existente ou diagnosticar?"
- "Você já tem screenshot/Figma/template para eu seguir?" (se for interface)
- "Você já tem um design system próprio?"

Essas perguntas são os **skill-gates** (veja `docs/guides/skill-gates.md`). Cada uma
existe para você não perder trabalho depois.

## 3. Ver e rodar o projeto

```
gstack_vibehard dev
```

Sobe o ambiente de desenvolvimento supervisionado. Quando estiver pronto, o produto
te diz a URL para abrir no navegador.

## 4. Provar que está tudo verde

```
gstack_vibehard proof
```

Roda a bateria de provas (verify + auditoria + prontidão de ferramentas) e responde
`ready: true` quando o pacote está íntegro. É a sua garantia objetiva — não é opinião
de um modelo, são checagens determinísticas.

## 5. Entender por que uma etapa travou

Se um gate te barrar, pergunte o porquê:

```
gstack_vibehard skills why design-system-gate
```

Ele explica, em uma tela, **por que** o gate existe e **como** satisfazê-lo.

## 6. Sair limpo

```
gstack_vibehard uninstall
```

Remove o que foi instalado, sem deixar resíduo de configuração global.

---

Próximo: `docs/guides/examples.md` (exemplos por intenção) e
`docs/guides/skill-gates.md` (o que cada gate checa e por quê).
