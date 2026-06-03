---
name: g_update
description: "Atualizar o framework gstack_vibehard para a versao mais recente. Ativado por /g_update."
trigger: /g_update
---

# /g_update — Atualizar gstack_vibehard

## Fluxo

### 1. Verificar versao atual

```bash
gstack_vibehard --version
npm view @gstack-vibehard/installer version
```

Compare local vs latest.

### 2. Se desatualizado

```bash
npm update -g @gstack-vibehard/installer
```

Se `npm update` nao funcionar (versao muito antiga):

```bash
npm install -g @gstack-vibehard/installer@latest
```

### 3. Re-aplicar configuracao

```bash
gstack_vibehard install
```

Isso re-aplica:
- Hooks Python (9 scripts)
- Skills (106 skills)
- MCP servers (7 servidores)
- Configuracoes de harness (Codex, Claude, OpenCode)
- CLAUDE.md / regras

### 4. Verificar

```bash
gstack_vibehard doctor
```

### 5. Exibir changelog

```bash
# Mostrar o que mudou entre versoes
npm view @gstack-vibehard/installer versions --json
```

(Exiba so as versoes entre a antiga e a nova.)

## Regras

1. Se ja estiver na versao mais recente, exiba: "Ja esta na versao mais recente (vX.Y.Z)"
2. Se a instalacao quebrar, exiba: "Erro ao atualizar. Rode manualmente: npm install -g @gstack-vibehard/installer@latest && gstack_vibehard install"
3. Apos atualizar, sempre rode `gstack_vibehard doctor` para confirmar que tudo esta OK
