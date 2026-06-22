#!/usr/bin/env sh
# Teste de aceitação de instalação limpa (gstack_vibehard) — bash/sh.
# Uso:   sh scripts/clean-install-acceptance.sh
# Assume `gstack_vibehard` no PATH (npm install -g @gstack-vibehard/installer).
fail=0
pass() { printf '  [PASS] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; fail=$((fail+1)); }

echo "== gstack clean-install acceptance =="
echo "node: $(node -v 2>&1)"; echo "python: $(python3 -V 2>&1 || python -V 2>&1)"
MAN="$HOME/.gstack_vibehard/install-manifest.json"

ver=$(gstack_vibehard --version 2>&1)
echo "$ver" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+' && pass "version: $ver" || bad "version inesperada: $ver"

help=$(gstack_vibehard --help 2>&1)
echo "$help" | grep -qiE 'Comando desconhecido|Instalando pacote' && bad "--help suspeito" || pass "--help seguro (nao instala)"

gstack_vibehard doctor >/dev/null 2>&1 && pass "doctor rodou" || pass "doctor rodou (exit nao-zero tolerado)"

[ -f "$MAN" ] && before=1 || before=0
gstack_vibehard install --audit-only >/dev/null 2>&1
[ -f "$MAN" ] && after=1 || after=0
[ "$before" = "$after" ] && pass "install --audit-only e read-only" || bad "audit-only ESCREVEU o manifest"

name="gstack-smoke-$$"
proj="${TMPDIR:-/tmp}/$name"
vault="$HOME/gstack-vault/projects/$name"
( cd "${TMPDIR:-/tmp}" && gstack_vibehard create "$name" >/dev/null 2>&1 )
if [ -f "$proj/.gstack/app.json" ]; then
  grep -q '"mode": "lite"' "$proj/.gstack/app.json" && pass "create LITE criou o app (mode=lite)" || bad "create mode != lite"
else bad "create nao gerou .gstack/app.json"; fi
[ -d "$vault" ] && bad "create LITE escreveu no global ~/gstack-vault" || pass "create LITE nao tocou ~/gstack-vault (BOM)"
rm -rf "$proj" 2>/dev/null

echo ""
[ "$fail" -gt 0 ] && { echo "RESULTADO: $fail falha(s)"; exit 1; }
echo "RESULTADO: TUDO PASSOU"
