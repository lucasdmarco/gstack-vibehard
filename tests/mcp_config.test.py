import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MCP_CONFIG = REPO_ROOT / "mcp-configs" / "base.mcp.json"


class McpConfigTest(unittest.TestCase):
    def test_base_mcp_config_declares_required_servers(self):
        data = json.loads(MCP_CONFIG.read_text(encoding="utf-8"))
        servers = data["mcpServers"]
        expected = {
            "mom",
            "agentmemory-graphify",
            "headroom",
            "composio",
            "supabase",
            "permit-rbac",
            "litellm",
        }
        self.assertEqual(set(servers), expected)
        self.assertEqual(servers["agentmemory-graphify"]["env"]["GRAPHIFY_GRAPH"], "graphify-out/graph.json")
        self.assertIn("CodeCompressor", servers["headroom"]["env"]["HEADROOM_COMPRESSORS"])
        self.assertIn("SmartCrusher", servers["headroom"]["env"]["HEADROOM_COMPRESSORS"])
        self.assertEqual(servers["composio"]["args"], ["-y", "@composio/mcp"])
        self.assertEqual(servers["supabase"]["args"][0:2], ["-y", "@supabase/mcp-server"])


if __name__ == "__main__":
    unittest.main()
