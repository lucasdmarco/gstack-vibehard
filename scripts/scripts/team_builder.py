#!/usr/bin/env python3
"""Build Claude Code Agent Teams launch instructions from harness patterns."""

from __future__ import annotations

import json
import os
import sys


EXPERIMENTAL_ENV = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"


TEAM_PATTERNS: dict[str, dict[str, object]] = {
    "producer-reviewer": {
        "title": "Producer-Reviewer",
        "leader": "Orchestrator",
        "members": [
            "Frontend Specialist",
            "Backend Specialist",
            "QA Automation Engineer",
            "Security Auditor",
        ],
        "flow": [
            "Lider decompoe a tarefa em unidades pequenas.",
            "Producer implementa a menor mudanca correta.",
            "Reviewer valida comportamento, testes e riscos.",
            "QA executa verificacoes, incluindo Docker sandbox quando aplicavel.",
        ],
    },
    "pipeline": {
        "title": "Pipeline",
        "leader": "Project Planner",
        "members": [
            "Explorer Agent",
            "Backend Specialist",
            "Frontend Specialist",
            "Test Engineer",
            "Documentation Writer",
        ],
        "flow": [
            "Explorer coleta contexto.",
            "Backend e Frontend implementam por etapa.",
            "Test Engineer valida cada passagem.",
            "Documentation Writer registra decisoes e uso.",
        ],
    },
    "fan-out": {
        "title": "Fan-Out",
        "leader": "Orchestrator",
        "members": [
            "Explorer Agent",
            "Code Archaeologist",
            "Performance Optimizer",
            "Security Auditor",
            "QA Automation Engineer",
        ],
        "flow": [
            "Lider abre frentes independentes em paralelo.",
            "Membros investigam caminhos sem compartilhar estado mutavel.",
            "Lider consolida achados e escolhe plano minimo.",
            "QA valida a convergencia final em sandbox isolado.",
        ],
    },
}


def supported_patterns() -> list[str]:
    return sorted(TEAM_PATTERNS)


def validate_pattern(argv: list[str]) -> str:
    cleaned = [arg.strip() for arg in argv if arg.strip()]
    if len(cleaned) != 1:
        raise ValueError("exactly one pattern argument is required")
    pattern = cleaned[0].lower()
    if pattern not in TEAM_PATTERNS:
        raise ValueError(f"unsupported pattern: {pattern}")
    return pattern


def build_spawn_prompt(pattern: str) -> str:
    spec = TEAM_PATTERNS[pattern]
    members = "\n".join(f"- {member}" for member in spec["members"])
    flow = "\n".join(f"{index + 1}. {step}" for index, step in enumerate(spec["flow"]))
    return f"""Agent Teams pattern: {spec['title']} via revfactory/harness.

Lider: {spec['leader']}

Membros da Equipe:
{members}

Topologia:
{flow}

Regras de Execucao:
- Habilite Agent Teams com CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1.
- O Lider deve delegar trabalho por fronteiras claras e verificaveis.
- Cada membro deve devolver evidencias, arquivos tocados, riscos e comandos executados.
- Use Docker sandbox para validar codigo antes de declarar sucesso.
- Preserve stdout JSON de hooks e nao ignore falhas de teste.
- Ao final, o Lider consolida uma decisao unica e uma lista curta de proximas acoes.
"""


def build_team(pattern: str) -> dict[str, object]:
    os.environ[EXPERIMENTAL_ENV] = "1"
    prompt = build_spawn_prompt(pattern)
    return {
        "ok": True,
        "pattern": pattern,
        "env": {EXPERIMENTAL_ENV: "1"},
        "command": ["claude", "--agent-teams"],
        "instruction": f"Execute com {EXPERIMENTAL_ENV}=1 e inicie Claude Code Agent Teams no padrao {pattern}.",
        "spawn_prompt": prompt,
        "supported_patterns": supported_patterns(),
    }


def main(argv: list[str] | None = None) -> int:
    try:
        pattern = validate_pattern(argv if argv is not None else sys.argv[1:])
        print(json.dumps(build_team(pattern), indent=2, ensure_ascii=True))
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "error": str(exc),
            "supported_patterns": supported_patterns(),
        }, indent=2, ensure_ascii=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
