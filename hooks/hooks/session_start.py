#!/usr/bin/env python3
"""SessionStart hook: injects project context + chronicle memories + gc diagnostic + identity.

Integrates highermind patterns:
  1. Identity injection — sets world-class quality bar at session start
  2. Weighted stack decision framework — helps agents choose optimal tech stack
  3. Security-first awareness — reminds security baseline checks
"""
import json, sys, os, subprocess
from pathlib import Path


def build_chronicle_index():
    """Constrói índice de busca sobre todos os arquivos chronicle."""
    chronicle_dir = Path.home() / ".codex" / "chronicle"
    if not chronicle_dir.exists():
        return []
    entries = []
    for f in sorted(chronicle_dir.glob("*.md"), key=os.path.getmtime, reverse=True):
        text = f.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        project = ""
        summary = ""
        cwd = ""
        for line in lines:
            if line.startswith("# Session:"):
                project = line.replace("# Session:", "").strip()
            elif line.startswith("- Working directory:"):
                cwd = line.replace("- Working directory:", "").strip()
        in_summary = False
        summary_lines = []
        for line in lines:
            if line.strip() == "## Summary":
                in_summary = True
                continue
            if line.startswith("## "):
                in_summary = False
            if in_summary and line.strip():
                summary_lines.append(line.strip())
        summary = " ".join(summary_lines)[:500]
        entries.append({
            "file": f.name,
            "project": project,
            "cwd": cwd,
            "summary": summary,
            "mtime": f.stat().st_mtime,
        })
    return entries


def search_chronicle(index, query: str, limit: int = 3):
    """Busca no índice por termo (case-insensitive, substring)."""
    q = query.lower()
    scored = []
    for e in index:
        score = 0
        if q in e["project"].lower():
            score += 3
        if q in e["summary"].lower():
            score += 2
        if q in e["cwd"].lower():
            score += 1
        if score > 0:
            scored.append((score, e))
    scored.sort(key=lambda x: (-x[0], -x[1]["mtime"]))
    return [e for _, e in scored[:limit]]


def run_gc_check(cwd: str) -> str | None:
    """Executa gc.py e retorna o diagnóstico textual."""
    gc_path = Path.home() / ".codex" / "hooks" / "gc.py"
    if not gc_path.exists():
        return None
    if not cwd:
        return None
    try:
        result = subprocess.run(
            ["python", str(gc_path), "--path", cwd],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            return data.get("diagnostic_text")
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        pass
    return None


# ═══════════════════════════════════════════════════════════════
#  IDENTITY INJECTION (highermind CLAUDE.md.template pattern)
# ═══════════════════════════════════════════════════════════════

IDENTITY_BLOCK = """## Identity & Standard

**Quem eu sou:** Fundador e CTO. Construo porque nao consigo nao construir. Penso em decadas, nao em sprints. Eu dirijo, eu arquiteto, eu tomo decisoes. Voce escreve o codigo. Mas o meu padrao e o padrao.

**O padrao:** World-class. Em todas as camadas. Inegociavel.

Isso significa:
- Toda escolha tecnica e a melhor escolha disponivel. Nao a padrao. Nao a popular. A melhor.
- Seguranca nao e preocupacao pra depois. E construida desde o primeiro commit.
- Performance nao e fase de otimizacao. E restricao de design.
- Se alguem auditasse esse codebase pra comprar, nao encontraria nada pra ter vergonha.
- Nao shippe trabalho mediano. Nunca escolha ferramenta porque e popular. Nunca pule seguranca. Nunca deixe testes pra depois."""


# ═══════════════════════════════════════════════════════════════
#  WEIGHTED STACK DECISION FRAMEWORK (highermind hm-init pattern)
# ═══════════════════════════════════════════════════════════════

STACK_DECISION_FRAMEWORK = """## Stack Decision Framework

Ao escolher tecnologia para um novo projeto, use esta matriz de decisao:

| Criterio | Peso | Pergunta |
|---|---|---|
| Fit pro problema | CRITICO | Essa ferramenta resolve o core do problema melhor que as alternativas? |
| Performance | ALTO | Latencia, throughput, cold starts — atende os requisitos? |
| Custo em producao | ALTO | API calls, hosting, bandwidth — quanto custa rodar em escala? |
| Seguranca | ALTO | Historico de CVEs, atualizacoes de seguranca, supply chain confiavel? |
| Maturidade | MEDIO | Tem docs, comunidade, edge cases resolvidos? |
| Ecossistema | MEDIO | Libs, integracoes, tooling — o ecossistema resolve ou voce vai reinventar? |
| DX (Developer Experience) | MEDIO | Velocidade de iteracao, debugging, deploy — o dia a dia e fluido? |

**Anti-patterns:**
- "Todo mundo usa" nao e razao
- "E o que eu conheco" nao e razao (a menos que deadline justifique)
- "Pode ser que a gente precise" nao e razao pra adicionar dependencia

**Regras:**
- Justifique cada escolha em uma frase
- Se duas opcoes sao proximas, explique por que uma vence
- Zero dependencias injustificadas"""


# ═══════════════════════════════════════════════════════════════
#  SECURITY BASELINE REMINDER (highermind pattern)
# ═══════════════════════════════════════════════════════════════

SECURITY_BASELINE = """## Security Baseline (desde o commit zero)

Checklist obrigatorio para todo projeto:
- [ ] `.dockerignore` existe (exclui .env, .git, node_modules, __pycache__)
- [ ] Dockerfile usa multi-stage build (sem --reload, npm run dev, --debug)
- [ ] Container roda como non-root user
- [ ] `.env` no `.gitignore`
- [ ] `.env.example` com placeholders
- [ ] CORS configuravel via env var, nunca '*' em producao
- [ ] Swagger/docs endpoints desabilitados em producao
- [ ] Zero secrets hardcoded
- [ ] Health check endpoint que verifica dependencias reais

**Se .dockerignore nao existe, o projeto nao esta pronto. Ponto.**
**Se Dockerfile roda dev server, e CRITICO. Ponto.**
**Se container roda como root, e ALTO. Ponto.**"""


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

inp = json.loads(sys.stdin.read())
cwd = inp.get("cwd", "")
project_name = Path(cwd).name if cwd else "unknown"

ctx_parts = []

# 0. Identity injection (highermind)
ctx_parts.append(IDENTITY_BLOCK)

# 1. GStack Check (gc.py)
gc_diag = run_gc_check(cwd)
if gc_diag:
    ctx_parts.append(gc_diag)
else:
    skills_dir = Path.home() / ".agents" / "skills"
    if skills_dir.exists():
        skill_names = [d.name for d in skills_dir.iterdir() if d.is_dir()]
        ctx_parts.append(f"## Skills disponiveis ({len(skill_names)})\n{', '.join(sorted(skill_names))}")

# 2. Chroniclé — busca indexada
chronicle_index = build_chronicle_index()
if chronicle_index:
    last = chronicle_index[0]
    ctx_parts.append(f"## Ultima sessao ({last['project']})\n{last['summary'][:500]}")
    hits = search_chronicle(chronicle_index, project_name)
    if len(hits) > 1:
        extra = []
        for h in hits[1:]:
            extra.append(f"- {h['project']}: {h['summary'][:200]}")
        ctx_parts.append(f"## Memorias relacionadas a '{project_name}'\n" + "\n".join(extra))

# 3. MCP servers
config_toml = Path.home() / ".codex" / "config.toml"
if config_toml.exists():
    mcps = []
    for line in config_toml.read_text(encoding="utf-8").splitlines():
        if line.startswith("[mcp_servers."):
            mcps.append(line.split(".")[1].rstrip("]"))
    if mcps:
        ctx_parts.append(f"## MCP Servers configurados\n{', '.join(mcps)}")

# 4. Stack decision framework (highermind)
ctx_parts.append(STACK_DECISION_FRAMEWORK)

# 5. Security baseline reminder (highermind)
ctx_parts.append(SECURITY_BASELINE)

additional_context = "\n\n".join(ctx_parts) if ctx_parts else ""
output = {
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": additional_context
    }
}
sys.stdout.write(json.dumps(output))
