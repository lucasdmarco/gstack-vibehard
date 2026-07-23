# Media intake: transcript primeiro, frames só quando necessário

`src/capabilities/media-intake.js` roteia uma fonte de mídia (vídeo/áudio) para o backend
certo — nunca duplica pipelines, nunca gasta token de frame à toa.

## Regra de decisão

1. **Transcript/captions é sempre a primeira tentativa** — mesmo sem captions
   disponíveis, `selectMediaBackend` ainda prefere transcript (nunca pula direto pra
   frames sem necessidade real de timestamp visual).
2. **Frames só quando `visualTimestampNeeded: true`** — e mesmo aí, sempre com
   `boundedFrameBudget` (cap conservador de 20 frames, independente da duração — um
   vídeo de 10 horas não gera mais frames que um de 1 minuto).
3. **Dedupe por hash** (`dedupeFrames`) — frames idênticos nunca são contados/processados
   duas vezes.
4. **`DISALLOWED_BACKENDS` inclui `"token-burner"`** — nenhuma combinação de evidência
   pode selecionar esse backend.

## Consentimento de rede

`canIngestSource({ sourceType, consented })` recusa qualquer fonte `url` sem
consentimento explícito — nunca baixa nada sozinho. Arquivo local nunca exige
consentimento de rede.

## Retenção de arquivo temporário

`temporaryFileDisposition` — `delete_after_processing` por default; `retain_per_policy`
só quando explicitamente pedido.

## Claude Video: spike, não capacidade prometida

`src/tools/claude-video.js` — `CLAUDE_VIDEO_CAPABILITY_STATUS` é sempre
`"documented_external_reference"` nesta versão. `evaluatePromotionThreshold` só retorna
`"promoted_full_capability"` com um `benchmarkResult` REAL mostrando acurácia melhor que
a baseline Graphify/media **e** respeitando os orçamentos de token/limpeza — nenhum
benchmark foi rodado nesta sessão, então o status real permanece referência documentada.

## Limite honesto desta versão

Nenhuma credencial de provider é resolvida por este módulo — se algum dia um provider de
transcrição real for wireado, a resolução de credencial precisa passar por
`src/secrets/broker.js` (Secrets Broker), nunca inline. Este sprint entrega a lógica de
roteamento/orçamento/consentimento; não há integração real com um provider de vídeo
configurado nesta sessão.
