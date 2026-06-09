import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SESSION_START = REPO_ROOT / "hooks" / "hooks" / "session_start.py"


class SessionStartGovernanceTest(unittest.TestCase):
    def test_injects_governance_context_without_breaking_hook_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env.update({
                "GSTACK_USER_ID": "lucas",
                "GSTACK_RBAC_ROLES": "cto,developer",
                "PERMIT_TENANT_ID": "gstack-local",
                "COMPOSIO_API_KEY": "test-composio-key",
                "LITELLM_BASE_URL": "http://localhost:4000",
                "LITELLM_SKIP_HEALTHCHECK": "1",
            })
            result = subprocess.run(
                [sys.executable, str(SESSION_START)],
                input=json.dumps({"cwd": tmp}),
                capture_output=True,
                text=True,
                env=env,
                timeout=20,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            context = payload["hookSpecificOutput"]["additionalContext"]
            self.assertIn("## Governance Context", context)
            self.assertIn("Permit.io Payload Filtering", context)
            self.assertIn("subject: lucas", context)
            self.assertIn("roles: cto, developer", context)
            self.assertIn("Composio: active", context)
            self.assertIn("LiteLLM: configured", context)
            self.assertIn("ANTHROPIC_BASE_URL=http://localhost:4000", context)


if __name__ == "__main__":
    unittest.main()
