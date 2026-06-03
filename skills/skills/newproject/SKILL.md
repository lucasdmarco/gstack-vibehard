---
name: newproject
description: "Guided Architecture Walkthrough — passo a passo completo para iniciar um novo projeto com gstack_vibehard. Ativado por /newproject."
trigger: /newproject
---

# /newproject — Guided Architecture Walkthrough

## Identity
Sou fundador e CTO. O padrao e world-class. Inegociavel.

## Fluxo obrigatorio (9 passos)

Siga **TODOS os passos em ordem**. So avance quando o usuario confirmar cada passo.

---

### PASSO 1: Analise de requisitos

Pergunte ao usuario:
- **Dominio**: O que o projeto faz? Qual o problema resolve?
- **Publico**: Quem usa? Escala esperada? Dispositivos (web/mobile/desktop)?
- **Monetizacao**: Como ganha dinheiro? Budget de infra?
- **Time**: Quantos devs? Precisao de agentes IA no fluxo?
- **Timeline**: Prazos? MVP vs full product?

Documente as respostas para usar nos passos seguintes.

---

### PASSO 2: Framework de stack (8 criterios)

Para cada tecnologia (frontend, backend, banco, auth, deploy), avalie:

| Criterio | Peso | Nota (1-5) | Justificativa |
|----------|------|------------|---------------|
| Fit (encaixe com o problema) | 5 | | |
| Performance | 4 | | |
| Custo (infra + operacao) | 4 | | |
| Seguranca | 5 | | |
| Maturidade / Ecossistema | 3 | | |
| DX (developer experience) | 3 | | |
| Hiring pool (se aplicavel) | 2 | | |
| Total | 26 | | |

**Anti-patterns a evitar:**
- Next.js para projeto que e 90% backend
- Micro-servicos para time de 1 dev
- Rust para MVP de 2 semanas
- Serverless para latencia <50ms critica

**Recomendacao final**: Stack com justificativa escrita.

---

### PASSO 3: Arquitetura + pastas

Defina com o usuario:
- **Agent-first?** O projeto precisa de agentes IA integrados?
- **Monorepo vs multirepo?** Monorepo (pnpm/turborepo) para fullstack; multirepo para equipes grandes
- **Estrutura de pastas**:
  ```
  apps/
    web/        — frontend
    api/        — backend
  packages/
    db/         — schema + migrations
    shared/     — types + utils
  scripts/      — setup + dev helpers
  ```
- **Boundaries**: API entre layers (nunca importar DB diretamente do frontend)

---

### PASSO 4: Scaffold

```bash
gstack_vibehard init <nome-do-projeto> --variant <express|fastify|hono>
cd <nome-do-projeto>
pnpm install
npx shadcn@latest add button card input form table dialog select
```

Pergunte ao usuario:
- Nome do projeto
- Variante de backend (default: express)
- Precisa de shadcn components extras?

---

### PASSO 5: Seguranca OBRIGATORIA

**Nao negociavel** — configure antes do primeiro commit:

- [ ] `.dockerignore` com node_modules, .env, .git, __pycache__
- [ ] `Dockerfile` multi-stage (sem `--reload` em producao)
- [ ] Non-root user no container
- [ ] CORS por env var (nunca `*` em producao)
- [ ] Zero secrets hardcoded (.env.example + .gitignore)
- [ ] `npm audit` — zero vulnerabilidades criticas

---

### PASSO 6: Infra local

- [ ] Docker Compose com servicos: db (postgres), api, web
- [ ] Volumes nomeados (nao bind mounts para dados)
- [ ] Health checks em cada servico
- [ ] Migrations automaticas no entrypoint

---

### PASSO 7: Ecossistema gstack_vibehard

Instale as ferramentas que o usuario confirmar:

1. **gbrain** — contexto semantico do projeto
2. **graphify** — grafo de dependencias
3. **context7** — stack config + agent context
4. **superpowers** — scripts de dev (run.ps1, seed.ps1)
5. **chronicle** — memoria de sessoes

Para cada uma, pergunte "Instalar [ferramenta]?" e instale apenas se confirmar.

---

### PASSO 8: Documentacao

Crie `ARCHITECTURE.md` na raiz do projeto com:
- Stack escolhida (e por que)
- Decisoes arquiteturais (com ADRs se possivel)
- Trade-offs assumidos
- Security foundations
- Comandos uteis (dev, build, deploy, db)

---

### PASSO 9: Post-sprint inicial

```bash
gstack_vibehard sprint --save
```

Isso registra o estado inicial do projeto no chronicle e atualiza graphify + gbrain.

---

## Regras

1. **Nunca pule passos**. Siga a ordem.
2. **So avance quando o usuario confirmar** cada passo.
3. **Se o usuario dispor "sim para todos"**, instale tudo sem perguntar de novo.
4. **Apos o PASSO 9**, diga: "Projeto pronto. Comandos: pnpm dev | gstack_vibehard doctor | /g_update"
