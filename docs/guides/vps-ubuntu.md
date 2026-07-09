# Rodando o gstack_vibehard num VPS Ubuntu (headless) e no macOS

Guia de prontidão para ambientes sem desktop. A CLI é multiplataforma (CI roda em
`ubuntu-latest`, `windows-latest`, `macos-latest`), mas alguns recursos degradam
de forma **declarada** quando não há keychain gráfico ou sqlite nativo.

## Requisitos mínimos

| Componente | Mínimo | Recomendado | Sem ele |
|------------|--------|-------------|---------|
| Node.js    | 18     | 22.5+       | < 18 não roda; < 22.5 usa State Store em `jsonl_fallback` (declarado) |
| Python     | 3.10   | 3.12        | hooks de segurança não rodam (fail-open — não travam o turno) |
| git        | 2.30+  | recente     | worktree/delegação indisponíveis |

Instalação:

```bash
sudo apt-get update && sudo apt-get install -y nodejs npm python3 git
npm i -g @gstack-vibehard/installer
gstack_vibehard doctor
```

## O que degrada num VPS headless (e como confirmar)

### 1. Broker de segredos (keychain)

No Linux o broker usa `secret-tool` (libsecret) + um **Secret Service D-Bus**
(gnome-keyring), que normalmente **não existe** num VPS headless. Nesse caso:

```bash
gstack_vibehard secrets doctor
#   Provider: (nenhum keychain disponível) ✗
```

Isso é honesto — nada de OK falso. `secrets set/import` vão recusar guardar
segredo em claro. Opções:

- **Rodar um keyring sob D-Bus** (persiste enquanto a sessão viver):
  ```bash
  sudo apt-get install -y gnome-keyring libsecret-tools
  dbus-run-session -- sh -c '
    echo -n "senha-do-keyring" | gnome-keyring-daemon --unlock
    gstack_vibehard secrets set DATABASE_URL --stdin < /caminho/seguro/valor
  '
  ```
- **Injetar segredos de runtime pelo ambiente** (sem keychain), deixando o gestor
  do VPS (systemd `EnvironmentFile=`, secret manager do provedor) dono do valor:
  ```bash
  DATABASE_URL=... GH_TOKEN=... gstack_vibehard <comando>
  ```
  O `secrets run` injeta só em memória; nunca loga o valor.

### 2. State Store

`.gstack/state.db` usa `node:sqlite` (Node ≥ 22.5). Em Node 18/20 cai para
`.gstack/state.jsonl` — mesma API, degradação declarada em `store.backend`. Confirme:

```bash
gstack_vibehard state summary --json | grep backend
```

### 3. Wizards e TTY

`start`, `agent-reach enable` e `secrets set` detectam ausência de terminal
interativo e **exigem flags explícitas** em vez de travar:

```bash
gstack_vibehard tools agent-reach enable --core       # sem wizard
gstack_vibehard secrets set DATABASE_URL --stdin      # valor por stdin
```

### 4. Downloads remotos

Por padrão o gstack **não** baixa/executa script remoto — sugere o comando manual.
Para permitir (só de origens na allowlist HTTPS), use `--allow-remote-downloads`.
O download vai para um diretório temporário privado (`mkdtemp`, `0700`) e é
removido após executar.

## macOS

O broker usa o Keychain do sistema (`security`). Funciona em Mac de usuário único
sem configuração. **Nota de segurança:** ao gravar (`secrets set`), o valor passa
como argumento para a ferramenta `security` do sistema — num Mac **multiusuário**
outro usuário local poderia vê-lo via `ps` durante a fração de segundo da escrita
(ver `.docs/AUDITS/security-audit-v3.36.md`, SEC-01). Em Mac pessoal isso é
irrelevante.

## Checklist de prontidão

```bash
gstack_vibehard doctor                 # ambiente geral
gstack_vibehard doctor --supply-chain  # registry oficial, PATH sem hijack
gstack_vibehard secrets doctor         # broker disponível? (headless: provável não)
gstack_vibehard state summary --json   # backend sqlite ou jsonl_fallback
gstack_vibehard dream audit --json     # promessas vs evidência (sem PLACEBO)
```
