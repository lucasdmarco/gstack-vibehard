"""Redaction pré-publicação (PRD Fase 3 §8): segredos mascarados antes de qualquer
publicação externa; eventos com fingerprint, nunca o segredo bruto."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HOOKS = Path(__file__).resolve().parents[1] / "hooks" / "hooks"
sys.path.insert(0, str(HOOKS))

from _redact import redact_secrets, log_redaction_event, REDACTION_MARK  # noqa: E402


class RedactionTest(unittest.TestCase):
    def test_mascara_token_stripe_e_github(self):
        text = "deploy com sk_live_ABCD1234EFGH5678IJKL90 e ghp_" + "A" * 36
        redacted, events = redact_secrets(text)
        self.assertIn(REDACTION_MARK, redacted)
        self.assertNotIn("sk_live_ABCD1234EFGH5678IJKL90", redacted, "segredo nao pode sobrar")
        self.assertNotIn("ghp_" + "A" * 36, redacted)
        self.assertGreaterEqual(len(events), 2)

    def test_evento_tem_fingerprint_nao_segredo(self):
        secret = "api_key=\"supersecretvalue123\""
        _, events = redact_secrets(secret)
        self.assertTrue(events)
        for e in events:
            self.assertTrue(e["fingerprint"].startswith("sha256:"))
            self.assertNotIn("supersecretvalue123", json.dumps(e), "fingerprint nunca expoe o segredo")

    def test_texto_limpo_nao_muda(self):
        clean = "Fallow bloqueou 2 CRITICOS no arquivo src/app.js"
        redacted, events = redact_secrets(clean)
        self.assertEqual(redacted, clean)
        self.assertEqual(events, [])

    def test_log_event_grava_fingerprint_sem_segredo(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, events = redact_secrets("token=\"abcdefgh12345678\"")
            ok = log_redaction_event(tmp, "gitops_issue", events)
            self.assertTrue(ok)
            log = Path(tmp) / "security" / "events.jsonl"
            content = log.read_text(encoding="utf-8")
            rec = json.loads(content.strip())
            self.assertEqual(rec["context"], "gitops_issue")
            self.assertGreaterEqual(rec["redactions"], 1)
            self.assertNotIn("abcdefgh12345678", content, "segredo nunca vai pro log")

    def test_log_event_vazio_nao_grava(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(log_redaction_event(tmp, "x", []))


if __name__ == "__main__":
    unittest.main()
