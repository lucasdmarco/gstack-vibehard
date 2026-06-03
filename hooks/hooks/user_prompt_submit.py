#!/usr/bin/env python3
"""UserPromptSubmit hook: inject skill hints based on prompt."""
import json, sys, re
from pathlib import Path

inp = json.loads(sys.stdin.read())
prompt = inp.get("prompt", "")
cwd = inp.get("cwd", "")

prompt_lower = prompt.lower()

skills_dir = Path.home() / ".agents" / "skills"
if not skills_dir.exists():
    sys.exit(0)

skill_hints = []

# Map keywords to skills
SKILL_MAP = {
    "deploy": "deployment",
    "deploy to": "deployment",
    "database": "database",
    "supabase": "database",
    "sql": "database",
    "migration": "migrate-to-multi-artifact, database",
    "slide": "slides",
    "presentation": "slides",
    "artifacts": "artifacts",
    "artifact": "artifacts",
    "canvas": "canvas",
    "whiteboard": "canvas",
    "object storage": "object-storage",
    "upload": "object-storage",
    "storage": "object-storage",
    "project": "new-project",
    "scaffold": "new-project",
    "template": "new-project",
    "test": "auto-testing",
    "playwright": "auto-testing",
    "browser": "auto-testing",
    "pr": "split-to-prs",
    "pull request": "split-to-prs",
    "rule": "create-rule",
    "hook": "create-hook",
    "workflow": "workflows",
    "mockup": "mockup-sandbox, mockup-graduate",
    "prototype": "mockup-sandbox",
    "figma": "mockup-graduate",
    "mcp": "mcp-setup",
    "server": "mcp-setup",
    "integration": "integrations",
    "query": "query-integration-data",
    "chart": "slides, query-integration-data",
}

for keyword, skills in SKILL_MAP.items():
    if keyword in prompt_lower:
        for skill in skills.split(", "):
            skill_path = skills_dir / skill / "SKILL.md"
            if skill_path.exists():
                skill_hints.append(skill)

if skill_hints:
    hints = ", ".join(set(skill_hints))
    additional_context = f"Dica: este prompt parece relacionado às skills: {hints}. Se precisar, carregue a skill correspondente."
    output = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": additional_context
        }
    }
    sys.stdout.write(json.dumps(output))
    sys.exit(0)

sys.exit(0)
