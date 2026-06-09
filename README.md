# 🚀 gstack-vibehard 2.0.6
**A Máquina de Desenvolvimento Zero-Config Definitiva para Agentes de IA.**

O `gstack-vibehard` é um **Control Plane e Instalador Cross-Harness**. Ele envelopa o seu terminal com ferramentas de elite, transformando Claude Code, Cursor, OpenCode e Codex em um ecossistema corporativo seguro, unificado e autônomo, rodando 100% na sua máquina.

Chega de alucinações, vazamentos de dados ou perda de contexto. O `gstack-vibehard` implementa a mesma infraestrutura de workspaces do Replit Agent 4, mas operando no seu CLI favorito.

---

## ✨ O que há de novo na v2.0.6 (The Convergence Update)

- 🛡️ **Zero-Trust Output Guard:** Um "Agente Porteiro" intercepta as saídas da IA. Usa RBAC para escanear e bloquear vazamentos de 8 classes de dados sensíveis (Chaves Stripe, Tokens GitHub, CPFs, etc.) antes de exibi-los na tela.
- 📦 **Replitização do Workspace:** Os projetos agora nascem com os manifestos de app nativos (`.gstack/app.json`, `ports.json` e `services.json`), definindo comandos de execução e portas dinâmicas automaticamente.
- 🔌 **Harness Bridge Real:** Eventos de ferramentas e lifecycle são roteados nativamente. Suporte profundo a `.cursor/rules` no Cursor, `hooks.json` (`tool.execute.before`) no OpenCode e `settings.json` no Claude.
- 🪶 **Modo `--lite`:** PC fraco ou sem Docker/Rust? Use `gstack_vibehard create meu-app --lite` para gerar o projeto e a estrutura de agentes burlando a inicialização de daemons pesados.
- 🔒 **RCE-Safe & Hardened:** Substituição completa de execuções de shell cruas (`execSync`) por `execFileSync`. Nenhuma URL ou caminho malicioso injetado por IA pode comprometer sua máquina. Crashs em Python causados por `stdin` vazios ou incompatibilidade de tipos foram erradicados.

---

## ⚡ Instalação Rápida (Padrão Ouro)

O instalador detecta automaticamente suas IDEs e faz a injeção em background.

```bash
npm install -g @gstack-vibehard/installer
```

Para criar um novo projeto blindado:
```bash
gstack_vibehard create meu-projeto
```
(Para ambientes sem Docker/Rust, adicione a flag `--lite`)

---

## 🏗️ Templates Verticais Incluídos

O instalador permite gerar arquiteturas prontas passando a flag `--template`:

- `fullstack-monorepo` (Padrão: Express/Fastify/Hono)
- `saas-auth-stripe` (Next.js + Supabase + Stripe)
- `mobile-backend` (Expo + tRPC + PostgreSQL)
- `ai-agent-platform` (LangGraph + ChromaDB + FastAPI)

Exemplo:
```bash
gstack_vibehard create app-vendas --template saas-auth-stripe
```

---

## 🧠 A Arquitetura Invisível (O que instalamos por você)

Para que o desenvolvedor iniciante ("vibecoder") não precise ler manuais complexos, orquestramos em background:

- **Memória de Custo Zero (Graphify):** Lê a Árvore de Sintaxe Abstrata (AST) do projeto a custo zero e entrega um grafo de conhecimento para a IA não precisar ler arquivos inteiros.
- **Economia de Tokens (Headroom):** Um proxy MCP que esmaga o tráfego RAG, logs e saídas em até 95%, reduzindo sua fatura de API drasticamente.
- **Auditoria Matemática (Fallow):** Impede o commit de lixo gerado por IA. Avalia complexidade (CRAP) e código morto em subsegundos usando Rust, sem "achismos".
- **Governança Pós-Sprint:** Relatórios detalhados (`post_sprint.py`) calculam o ROI da sessão, arquivos modificados em massa via Atomic VCS, e decisões de negócio integradas ao servidor MOM.
- **Observabilidade TUI:** Digite `gstack_vibehard monitor` para ver o status dos times Harness, bloqueios de Quality Gate e economia de tokens em tempo real.

---

## 🛡️ Protocolos de Segurança Ativos

- **File Locking Estrito:** `fcntl`/`msvcrt` nativo evita corrupção do arquivo `instincts.yaml` durante concorrência de agentes.
- **GitOps Seguro:** Empurre código apenas com consentimento. `git push` automático bloqueado localmente.
- **MicroVM / Sandbox:** Suporte nativo ao Docker headless e gVisor via OpenHands CLI.
- **Sem Dependências Fantasmas:** Todas as chamadas `npx` foram limpas e sanitizadas na compilação.

---

## 📝 Licença

Desenvolvido sob a Licença MIT.
