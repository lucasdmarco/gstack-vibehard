# Reset & Uninstall — desfazer de verdade

Tudo que o `install` escreve é registrado no **manifest** com backup `.bak`. O `uninstall` remove **apenas o que o gstack registrou** e restaura os backups — nunca apaga além do manifest.

```bash
gstack_vibehard uninstall --dry-run     # PLANO: o que seria removido/restaurado (sem escrita)
gstack_vibehard uninstall               # rollback via manifest (preserva o que VOCÊ editou)
gstack_vibehard uninstall --resolve-drift    # força restauração mesmo com drift detectado
gstack_vibehard uninstall --yes --legacy-name-cleanup  # remoção completa (inclui install legado sem manifest)
```

## O que é preservado de propósito

- **Vault Obsidian**, **`~/.mcp.json`** de terceiros e **deps de sistema** (Bun/uv/Rust): o uninstall avisa e preserva — remover ferramenta compartilhada quebraria outros fluxos seus.
- **Projetos criados** (`create`): são SEUS — nunca são tocados pelo uninstall.
- **Agent Reach**: registro fica em `.gstack/integrations.json` do projeto; cookies/config sensível vivem no storage do próprio backend (o uninstall diz o que preservou).

## Reparar em vez de remover

```bash
gstack_vibehard install --reinstall       # reaplica hooks/config (conserta install antigo)
gstack_vibehard doctor --install-integrity  # manifest/backups/hashes íntegros?
gstack_vibehard doctor --repair-manifest --dry-run  # plano de limpeza do manifest
```

## Desativar sem remover (por projeto)

```bash
gstack_vibehard disable    # renomeia .gstack/ → .gstack-disabled/ (dados preservados)
gstack_vibehard enable     # reativa
```
