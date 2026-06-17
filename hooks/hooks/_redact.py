#!/usr/bin/env python3
"""_redact.py — Redaction reutilizável (PRD Fase 3 §8).

O Output Guard DETECTA segredos; este módulo os MASCARA antes de qualquer
publicação externa (GitOps). Eventos registrados nunca contêm o segredo bruto —
apenas um fingerprint (hash) e o nome do padrão.
"""

import re
import json
import hashlib
from datetime import datetime
from pathlib import Path

from _output_guard import SENSITIVE_PATTERNS

REDACTION_MARK = "***REDACTED***"


def _fingerprint(secret: str) -> str:
    return "sha256:" + hashlib.sha256(secret.encode("utf-8", "ignore")).hexdigest()[:12]


def redact_secrets(text):
    """Mascara segredos/PII. Retorna (texto_redigido, eventos).

    eventos = lista de {pattern, fingerprint} — SEM o segredo em claro.
    """
    if not text:
        return text, []
    events = []
    redacted = text
    for pat in SENSITIVE_PATTERNS:
        def _repl(m, _pat=pat):
            events.append({"pattern": _pat[:24], "fingerprint": _fingerprint(m.group(0))})
            return REDACTION_MARK
        redacted = re.sub(pat, _repl, redacted)
    return redacted, events


def log_redaction_event(base_dir, context, events):
    """Anexa um evento de segurança SANITIZADO (sem segredo) em
    <base>/security/events.jsonl. Retorna True se gravou."""
    if not events:
        return False
    try:
        d = Path(base_dir) / "security"
        d.mkdir(parents=True, exist_ok=True)
        rec = {
            "ts": datetime.now().isoformat(),
            "context": context,
            "redactions": len(events),
            "fingerprints": [e["fingerprint"] for e in events],
        }
        with (d / "events.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
        return True
    except Exception:
        return False
