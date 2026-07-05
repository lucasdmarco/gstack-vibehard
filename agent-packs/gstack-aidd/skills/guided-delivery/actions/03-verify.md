# Action 03 — Verify (gate determinístico)

## Inputs

- As mudanças da action 02, na worktree.

## Processo

1. `gstack_vibehard verify --profile full --json` — roda o perfil de checks (JSON puro).
2. Trate o resultado como **autoridade**: se um gate falhou, corrija a causa e
   re-execute. Não force o merge.
3. `gstack_vibehard publish-guard` — portão final de PR/merge; recusa se os gates não
   passaram.

## Outputs

- Veredito determinístico (pass/fail) com evidência.
- Decisão de publicar **somente** após verde.

## Checklist

- [ ] `verify` verde ANTES de `publish-guard`.
- [ ] Se Fallow/QG estiver indisponível, tratar como **bloqueado**, não aprovado.
- [ ] Nenhuma afirmação de "pronto/merge/deploy" sem o gate determinístico.

> **O LLM nunca é o gate final.** Revisão por IA é advisory; quem decide "pronto" é o
> gate determinístico (QG/Fallow/`verify`).
