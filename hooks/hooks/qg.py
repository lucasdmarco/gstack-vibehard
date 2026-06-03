#!/usr/bin/env python3
"""Quality Gate — 3 níveis de validação com formato de auditoria highermind.

Formato de findings:
  [CRITICO/ALTO/MEDIO/BAIXO] Título
  Onde: arquivo
  Problema: o que está errado
  Impacto: o que acontece se não corrigir
  Fix: mudança específica necessária

Uso:
  python qg.py --path <projeto> --level 1 [--log-only]
  python qg.py --path <projeto> --level 2 [--log-only]
  python qg.py --path <projeto> --level 3 [--log-only]

Retorno (stdout): JSON { pass, blockers, warnings, non_actionable, issues, summary }
"""
import json, os, re, subprocess, sys
from pathlib import Path

# ── arquivos que podem ter < 30 linhas sem serem placeholder ──
WHITELIST_SHORT = {"index.ts", "index.tsx", "types.ts", ".gitkeep",
                   "vite-env.d.ts", "env.d.ts", "mock.ts", "data.ts"}

# ── issues não acionáveis por constraint de template ──
NON_ACTIONABLE_PATTERNS = [
    r"wouter.*react.*router",
    r"react.*router.*wouter",
]


def parse_args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--path", required=True)
    p.add_argument("--level", type=int, choices=[1, 2, 3], required=True)
    p.add_argument("--log-only", action="store_true")
    return p.parse_args()


def find_tsx_files(root: Path):
    """Retorna todos os .tsx do projeto (exclui node_modules, dist, .cache)."""
    files = []
    for pattern in ["**/*.tsx", "**/*.ts"]:
        for f in root.rglob(pattern):
            rel = f.relative_to(root).as_posix()
            if any(ignore in rel for ignore in ["node_modules", "dist", ".cache", ".git", ".next", "build"]):
                continue
            if f.name in WHITELIST_SHORT:
                continue
            files.append(f)
    return files


def make_finding(severity: str, title: str, file_path: str, problem: str, impact: str, fix: str) -> dict:
    """Cria finding no formato highermind padrao."""
    return {
        "severity": severity,
        "title": title,
        "file": file_path,
        "problem": problem,
        "impact": impact,
        "fix": fix
    }


# ═══════════════════════════════════════════════════════════════
#  LEVEL 1 — ESTRUTURAL + SEGURANCA (primeiro)
# ═══════════════════════════════════════════════════════════════
def check_level_1(root: Path, log_only: bool) -> tuple:
    """Placeholders, hook ordering, typecheck, security baseline."""
    issues = []
    files = find_tsx_files(root)

    # ── SEGURANCA PRIMEIRO (highermind pattern) ──
    # 1a. .dockerignore
    if (root / "Dockerfile").exists() or (root / "docker-compose.yml").exists() or (root / "docker-compose.yaml").exists():
        if not (root / ".dockerignore").exists():
            issues.append(make_finding(
                "CRITICO", "Sem .dockerignore",
                ".dockerignore",
                "Projeto com Docker mas sem .dockerignore",
                "Secrets vazam nas layers da imagem Docker. Qualquer pessoa com acesso a imagem extrai .env",
                "Criar .dockerignore no root com: .git, .env, .env.*, node_modules, __pycache__, .venv, dist, .next"
            ))
        # 1b. Multi-stage check
        for df in [root / "Dockerfile"]:
            if df.exists():
                text = df.read_text(encoding="utf-8", errors="ignore").lower()
                if "--reload" in text or "npm run dev" in text or "--debug" in text:
                    issues.append(make_finding(
                        "CRITICO", "Dev server em Dockerfile de producao",
                        "Dockerfile",
                        "Dockerfile contem --reload, npm run dev, ou --debug",
                        "Dev server em producao = hot reload instavel + source maps expostos + info leak",
                        "Usar entrypoints separados: entrypoint.sh (prod, sem reload) e entrypoint.dev.sh (dev, com reload). Dockerfile aponta pro prod."
                    ))

    # 1c. Secrets hardcoded
    secrets_patterns = [
        r'(?i)(api[-_]?key|apikey|secret|password|token|auth_token)\s*[=:]\s*["\'][^"\'"]{8,}',
    ]
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
            for sp in secrets_patterns:
                if re.search(sp, text):
                    rel = f.relative_to(root).as_posix()
                    issues.append(make_finding(
                        "CRITICO", "Secret hardcoded no codigo",
                        rel,
                        "API key, token, password ou secret encontrado diretamente no codigo fonte",
                        "Secrets hardcoded vazam no git history para sempre. Qualquer pessoa com acesso ao repo tem acesso ao secret.",
                        "Mover para .env + os.getenv(). Adicionar .env no .gitignore."
                    ))
                    break
        except Exception:
            continue

    # 1d. Placeholder: arquivo .tsx < 30 linhas
    for f in files:
        if f.suffix != ".tsx":
            continue
        lines = len(f.read_text(encoding="utf-8", errors="ignore").splitlines())
        if lines < 30:
            rel = f.relative_to(root).as_posix()
            issues.append(make_finding(
                "MEDIO", "Componente placeholder (menos de 30 linhas)",
                rel,
                f"Arquivo tem apenas {lines} linhas, possivelmente placeholder ou incompleto",
                "Componentes pequenos demais podem ser stubs ou esqueletos nao implementados",
                "Completar implementacao ou remover arquivo se nao for necessario"
            ))

    # 1e. Hook ordering: useState/useEffect após if return
    for f in files:
        if f.suffix != ".tsx":
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"if\s*\([^)]*\)\s*return[^;]*;\s*\n\s*(const\s+\[|useState|useEffect)",
                     text, re.MULTILINE):
            rel = f.relative_to(root).as_posix()
            issues.append(make_finding(
                "ALTO", "Hook apos conditional return",
                rel,
                "useState/useEffect declarado apos um if return, violando regras de hooks do React",
                "React hooks devem ser chamados incondicionalmente no topo do componente. Violacao causa estado inconsistente.",
                "Mover todos os hooks para antes de qualquer return condicional"
            ))

    # 1f. TypeScript check
    try:
        result = subprocess.run(
            ["pnpm", "run", "typecheck"],
            cwd=root, capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            errors = []
            for line in result.stderr.splitlines() + result.stdout.splitlines():
                if "error TS" in line:
                    errors.append(line.strip())
                if len(errors) >= 5:
                    break
            issues.append({
                "severity": "CRITICO",
                "title": "Erro(s) de TypeScript",
                "file": "typecheck",
                "problem": f"{len(errors)} erro(s) de tipo encontrados",
                "impact": "Type errors podem causar runtime exceptions inesperadas",
                "fix": "Corrigir cada erro TS. Se forem muitos, rodar typecheck local e corrigir em lote.",
                "detail": errors if errors else "typecheck failed"
            })
    except (subprocess.TimeoutExpired, FileNotFoundError):
        issues.append({
            "severity": "BAIXO",
            "title": "Typecheck nao executado",
            "file": "typecheck",
            "problem": "typecheck nao executado (timeout ou pnpm nao encontrado)",
            "impact": "Podem haver erros de tipo nao detectados",
            "fix": "Instalar dependencias e rodar pnpm run typecheck manualmente"
        })

    # ── Classificar nao acionaveis ──
    non_actionable = []
    for issue in issues:
        for pattern in NON_ACTIONABLE_PATTERNS:
            if re.search(pattern, issue.get("detail", "") or issue.get("file", ""), re.IGNORECASE):
                non_actionable.append(issue)
                break
    for na in non_actionable:
        issues.remove(na)

    return issues, non_actionable


# ═══════════════════════════════════════════════════════════════
#  LEVEL 2 — ESTADOS
# ═══════════════════════════════════════════════════════════════
def check_level_2(root: Path, log_only: bool) -> tuple:
    """Loading, empty, error states, module gating."""
    issues = []
    files = [f for f in find_tsx_files(root) if f.suffix == ".tsx"]

    # ── 2a. Missing loading state ──
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        if "useEffect" not in text or "loading" not in text.lower():
            rel = f.relative_to(root).as_posix()
            if any(skip in rel for skip in ["login", "not-found", "not_found", "__test"]):
                continue
            issues.append(make_finding(
                "ALTO", "Componente sem estado de loading",
                rel,
                "Componente com useEffect mas sem gerenciamento de estado loading",
                "Usuario ve tela vazia ou estado inconsistente durante carregamento de dados",
                "Adicionar estado loading (isLoading) + condicional: if (isLoading) return <LoadingSpinner />"
            ))

    # ── 2b. Missing empty state ──
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        if "EmptyState" not in text and ("filter" in text.lower() or "search" in text.lower()):
            rel = f.relative_to(root).as_posix()
            issues.append(make_finding(
                "MEDIO", "Componente sem estado vazio (empty state)",
                rel,
                "Componente com filtro/busca mas sem tratamento de resultados vazios",
                "Usuario ve tela em branco sem feedback quando filtro nao retorna resultados",
                "Adicionar <EmptyState message=\"Nenhum resultado encontrado\" /> quando lista vazia"
            ))

    # ── 2c. Missing error state ──
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        if "ErrorState" not in text:
            rel = f.relative_to(root).as_posix()
            if any(skip in rel for skip in ["login", "not-found", "not_found", "__test"]):
                continue
            issues.append(make_finding(
                "MEDIO", "Componente sem estado de erro",
                rel,
                "Componente com useEffect/mutacao mas sem tratamento de erro",
                "Usuario ve erro generico ou tela quebrada quando requisicao falha",
                "Adicionar estado error (error) + condicional: if (error) return <ErrorState message={error} />"
            ))

    return issues, []


# ═══════════════════════════════════════════════════════════════
#  LEVEL 3 — CONTEUDO
# ═══════════════════════════════════════════════════════════════
def check_level_3(root: Path, log_only: bool) -> tuple:
    """Tabs vazias, dados genéricos, admin stubs, links quebrados."""
    issues = []
    files = [f for f in find_tsx_files(root) if f.suffix == ".tsx"]

    # ── 3a. Tabs vazias ──
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        triggers = re.findall(r'<TabsTrigger\s+value="([^"]+)"', text)
        contents = re.findall(r'<TabsContent\s+value="([^"]+)"', text)
        for t in triggers:
            match = re.search(rf'<TabsContent\s+value="{t}"[^>]*>([^<]*)', text)
            content_empty = True
            if match and len(match.group(1).strip()) > 20:
                content_empty = False
            if content_empty and t not in contents:
                rel = f.relative_to(root).as_posix()
                issues.append(make_finding(
                    "ALTO", f"Tab '{t}' sem conteudo",
                    rel,
                    f"TabTrigger value=\"{t}\" sem TabsContent correspondente ou com conteudo vazio",
                    "Usuario ve aba vazia ou navegacao quebrada",
                    "Adicionar <TabsContent value=\"{t}\">...</TabsContent> com conteudo real"
                ))

    # ── 3b. Dados genéricos ──
    generic_patterns = [
        r'Colaborador\s+\d', r'Funcionario\s+\d', r'Employee\s+\d',
        r'lorem\s+ipsum', r'Lorem\s+Ipsum', r'placeholder',
        r'em breve', r'Em breve', r'Em Breve',
    ]
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        for pattern in generic_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                rel = f.relative_to(root).as_posix()
                issues.append(make_finding(
                    "MEDIO", "Dados genericos ou placeholder",
                    rel,
                    f"Contem texto placeholder: '{pattern}'",
                    "Dados genericos indicam que a funcionalidade nao foi implementada com dados reais",
                    "Substituir por dados reais do projeto ou mock realista"
                ))
                break

    # ── 3c. Admin stubs ──
    for f in files:
        if "admin" in f.name.lower():
            text = f.read_text(encoding="utf-8", errors="ignore")
            if re.search(r'\b(aqui|placeholder|TODO|FIXME|em breve)\b', text, re.IGNORECASE):
                rel = f.relative_to(root).as_posix()
                issues.append(make_finding(
                    "ALTO", "Admin page com placeholder",
                    rel,
                    "Pagina admin contem texto placeholder",
                    "Admin pages sao frequentemente acessadas por usuarios reais. Placeholders parecem descuido.",
                    "Implementar funcionalidade real ou remover pagina"
                ))

    return issues, []


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════
def severity_score(sev: str) -> int:
    return {"CRITICO": 4, "ALTO": 3, "MEDIO": 2, "BAIXO": 1}.get(sev, 0)


def main():
    args = parse_args()
    root = Path(args.path).resolve()
    level = args.level
    log_only = args.log_only

    if not root.exists():
        result = {"pass": False, "error": f"Path not found: {root}"}
        print(json.dumps(result))
        sys.exit(1)

    is_monorepo = (root / "pnpm-workspace.yaml").exists()
    page_dirs = []
    for d in ["src/pages", "src/app", "pages", "app"]:
        if (root / d).exists():
            page_dirs.append(root / d)

    if level == 1:
        issues, non_actionable = check_level_1(root, log_only)
    elif level == 2:
        issues, non_actionable = check_level_2(root, log_only)
    else:
        issues, non_actionable = check_level_3(root, log_only)

    # Ordenar issues por severidade (CRITICO primeiro)
    issues.sort(key=lambda i: -severity_score(i.get("severity", "BAIXO")))

    blockers = len([i for i in issues if i.get("severity") in ("CRITICO", "ALTO")])
    warnings_count = len([i for i in issues if i.get("severity") in ("MEDIO", "BAIXO")])
    pass_status = blockers == 0

    # Formato resumido por severidade
    by_severity = {}
    for i in issues:
        sev = i.get("severity", "BAIXO")
        by_severity[sev] = by_severity.get(sev, 0) + 1
    sev_summary = ", ".join(f"{v} {k}" for k, v in sorted(by_severity.items(), key=lambda x: -severity_score(x[0])))

    if pass_status:
        if issues:
            verdict = "World-class. Shippa."
        else:
            verdict = "World-class. Nada a apontar."
    else:
        verdict = "BLOQUEADO — resolva CRITICO/ALTO antes"

    result = {
        "pass": pass_status,
        "level": level,
        "blockers": blockers,
        "warnings": warnings_count,
        "by_severity": by_severity,
        "non_actionable": non_actionable,
        "issues": issues,
        "summary": f"Nivel {level}: {blockers} blocker(s), {warnings_count} warning(s)",
        "verdict": verdict
    }
    if sev_summary:
        result["summary"] += f" ({sev_summary})"
    if non_actionable:
        result["summary"] += f", {len(non_actionable)} nao acionavel(is)"

    print(json.dumps(result, indent=2, ensure_ascii=False))

    if not log_only and blockers > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
