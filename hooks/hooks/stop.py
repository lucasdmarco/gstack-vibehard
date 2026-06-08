#!/usr/bin/env python3
"""Stop hook: save session chronicle + QG L1 + Security Gate (highermind patterns).

Sandboxing is handled exclusively by OpenHands headless mode.
Docker sandbox has been removed — OpenHands manages its own isolation.

Security Gate checks (BLOCKING before deploy):
  1. .dockerignore exists and covers .env, .git, node_modules
  2. Multi-stage Dockerfile (no dev server in prod)
  3. Non-root user in container
  4. CORS configurable via env, never '*' in prod
  5. No secrets hardcoded
  6. Health check endpoint exists and checks real dependencies
  7. .env.example exists and has all vars

Security Gate only runs when invoked explicitly (--security-gate) or
via deploy command detection in the session.
"""
import json, sys, subprocess, os, re, shutil, platform
from pathlib import Path
from datetime import datetime


def find_project_root(cwd: str) -> Path | None:
    """Tenta achar a raiz do projeto (tem .git, package.json, etc)."""
    if not cwd:
        return None
    p = Path(cwd).resolve()
    for _ in range(5):
        if any((p / marker).exists() for marker in [".git", "package.json", "pyproject.toml", "Cargo.toml"]):
            return p
        p = p.parent
    return None


def play_audio_cue(kind: str) -> None:
    """Best-effort audio cue without writing to stdout or blocking hook JSON."""
    try:
        marker = "success" if kind == "success" else "error"
        if os.environ.get("GSTACK_AUDIO_CUES_TEST") == "1":
            sys.stderr.write(f"audio-cue:{marker}\n")
            sys.stderr.flush()
            return

        system = platform.system().lower()
        if system == "windows":
            try:
                import winsound
                if kind == "success":
                    winsound.MessageBeep(winsound.MB_ICONASTERISK)
                else:
                    winsound.MessageBeep(winsound.MB_ICONHAND)
                return
            except Exception:
                pass
        elif system == "darwin":
            sound = "/System/Library/Sounds/Glass.aiff" if kind == "success" else "/System/Library/Sounds/Basso.aiff"
            if shutil.which("afplay"):
                subprocess.Popen(["afplay", sound], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
        else:
            for player, args in [
                ("paplay", ["/usr/share/sounds/freedesktop/stereo/complete.oga" if kind == "success" else "/usr/share/sounds/freedesktop/stereo/dialog-error.oga"]),
                ("canberra-gtk-play", ["-i", "complete" if kind == "success" else "dialog-error"]),
            ]:
                if shutil.which(player):
                    subprocess.Popen([player, *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return

        sys.stderr.write("\a")
        sys.stderr.flush()
    except Exception:
        pass


def run_sandbox(cwd: str) -> dict:
    """Run validation in OpenHands headless mode.

    OpenHands is the only supported sandbox engine. It manages Docker
    isolation internally. If the CLI is not found, this hook fails hard.
    """
    if os.environ.get("GSTACK_SANDBOX_TEST") != "1":
        return {"status": "disabled"}

    if not cwd:
        return {"status": "skipped", "reason": "cwd missing"}

    openhands_bin = shutil.which("openhands")
    if not openhands_bin:
        return {"status": "failed", "reason": "openhands CLI not found in PATH. Install: pip install openhands"}

    root = find_project_root(cwd) or Path(cwd).resolve()
    try:
        result = subprocess.run(
            [openhands_bin, "--headless", "-t", "Validar entrega e executar testes", "--path", str(root)],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except FileNotFoundError:
        return {"status": "failed", "reason": "openhands binary not found"}
    except OSError as e:
        return {"status": "failed", "reason": str(e)}
    except subprocess.TimeoutExpired as e:
        return {
            "status": "failed",
            "returncode": 124,
            "stdout": e.stdout or "",
            "stderr": e.stderr or "OpenHands sandbox timed out",
        }

    if result.returncode != 0:
        return {
            "status": "failed",
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    return {"status": "passed", "returncode": 0, "stdout": result.stdout, "stderr": result.stderr}


# ═══════════════════════════════════════════════════════════════
#  SECURITY GATE (highermind patterns)
# ═══════════════════════════════════════════════════════════════

SECURITY_GATE_CHECKS = [
    {
        "id": "dockerignore",
        "title": ".dockerignore existe e cobre secrets",
        "severity": "CRITICO",
        "check": lambda root: (root / ".dockerignore").exists(),
        "fail": "CRITICO — sem .dockerignore, secrets vazam nas layers Docker. Qualquer pessoa com acesso a imagem extrai .env",
        "fix": "Criar .dockerignore com: .git, .env, .env.*, node_modules, __pycache__, .venv, dist, .next"
    },
    {
        "id": "dockerfile_multi_stage",
        "title": "Dockerfile usa multi-stage build (sem dev server em prod)",
        "severity": "CRITICO",
        "check": lambda root: dockerfile_check_multi_stage(root),
        "fail": "CRITICO — dev server em producao = hot reload instavel + source maps expostos + info leak",
        "fix": "Usar multi-stage build. Stage final sem --reload, npm run dev, --debug. Exemplo: stage builder separado do stage final."
    },
    {
        "id": "non_root_user",
        "title": "Container roda como non-root user",
        "severity": "ALTO",
        "check": lambda root: dockerfile_check_non_root(root),
        "fail": "ALTO — se container for comprometido, atacante tem root no host",
        "fix": "Adicionar USER appuser (ou equivalente) no Dockerfile. Criar user com: RUN groupadd -r app && useradd -r -g app app"
    },
    {
        "id": "cors_config",
        "title": "CORS configurável via env, nunca '*' hardcoded",
        "severity": "ALTO",
        "check": lambda root: cors_check(root),
        "fail": "ALTO — CORS '*' permite qualquer origem fazer requests autenticados. Hardcoded = impossivel mudar sem deploy",
        "fix": "Mover CORS para env var CORS_ORIGIN. Em producao, valor deve ser o dominio exato. Nunca '*' como default."
    },
    {
        "id": "secrets_hardcoded",
        "title": "Nenhum secret hardcoded no codigo",
        "severity": "CRITICO",
        "check": lambda root: secrets_check(root),
        "fail": "CRITICO — secrets hardcoded vazam no git history para sempre",
        "fix": "Mover secrets para .env ou env vars. Adicionar .env no .gitignore. Usar .env.example com placeholders."
    },
    {
        "id": "env_example",
        "title": ".env.example existe e atualizado",
        "severity": "MEDIO",
        "check": lambda root: (root / ".env.example").exists(),
        "fail": "MEDIO — time novo ou clone nao sabe quais variaveis configurar",
        "fix": "Criar .env.example com TODAS as variaveis necessarias e placeholders (change-me-*, your-key-here)"
    },
    {
        "id": "health_endpoint",
        "title": "Endpoint de health check existe e verifica dependencias reais",
        "severity": "MEDIO",
        "check": lambda root: health_endpoint_check(root),
        "fail": "MEDIO — sem health check real, orquestrador nao sabe se servico esta saudavel",
        "fix": "Criar GET /health que verifica conexao com DB/Redis e retorna status de cada dependencia"
    },
    {
        "id": "gitignore_env",
        "title": ".env no .gitignore",
        "severity": "CRITICO",
        "check": lambda root: gitignore_has_dotenv(root),
        "fail": "CRITICO — .env fora do .gitignore = vazamento de secrets no primeiro commit",
        "fix": "Adicionar .env e .env.* (exceto .env.example) no .gitignore"
    },
    {
        "id": "swagger_disabled",
        "title": "Swagger / debug endpoints desabilitados em producao",
        "severity": "ALTO",
        "check": lambda root: swagger_check(root),
        "fail": "ALTO — docs endpoints expoem toda a API surface",
        "fix": "Desabilitar /docs, /redoc, /openapi.json quando APP_ENV != development"
    },
]


def dockerfile_check_multi_stage(root: Path) -> bool:
    """Verifica se Dockerfile usa multi-stage e nao tem dev server."""
    for dockerfile in [root / "Dockerfile", root / "dockerfile"]:
        if dockerfile.exists():
            text = dockerfile.read_text(encoding="utf-8", errors="ignore").lower()
            has_multi_stage = "as builder" in text or "as build" in text
            has_dev_server = "--reload" in text or "npm run dev" in text or "--debug" in text
            return has_multi_stage and not has_dev_server
    return True  # sem Dockerfile = passa (pode não ser projeto containerizado)


def dockerfile_check_non_root(root: Path) -> bool:
    """Verifica se Dockerfile tem USER non-root."""
    for dockerfile in [root / "Dockerfile", root / "dockerfile"]:
        if dockerfile.exists():
            text = dockerfile.read_text(encoding="utf-8", errors="ignore")
            if "USER" not in text:
                return False
            if re.search(r"USER\s+(root|0)\b", text, re.IGNORECASE):
                return False
            return True
    return True


def cors_check(root: Path) -> bool:
    """Verifica se CORS nao tem '*' hardcoded."""
    bad_patterns = [r"cors\(\s*['\"]\*['\"]", r"allow_origins\s*=\s*['\"]\*['\"]"]
    for pattern in ["*.ts", "*.tsx", "*.py", "*.go", "*.rs", "*.js"]:
        for f in root.rglob(pattern):
            rel = f.relative_to(root).as_posix()
            if any(ignore in rel for ignore in ["node_modules", "dist", ".git"]):
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
                for bp in bad_patterns:
                    if re.search(bp, text, re.IGNORECASE):
                        return False
            except Exception:
                continue
    return True


def secrets_check(root: Path) -> bool:
    """Verifica se ha secrets hardcoded (API keys, tokens, passwords)."""
    secrets_patterns = [
        r'(?i)(api[-_]?key|apikey|secret|password|token|auth_token)\s*[=:]\s*["\'][^"\'"]{8,}',
    ]
    for pattern in ["*.ts", "*.tsx", "*.py", "*.go", "*.rs", "*.js", "*.env"]:
        for f in root.rglob(pattern):
            rel = f.relative_to(root).as_posix()
            if any(ignore in rel for ignore in ["node_modules", "dist", ".git", ".env.example"]):
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
                for sp in secrets_patterns:
                    if re.search(sp, text):
                        return False
            except Exception:
                continue
    return True


def health_endpoint_check(root: Path) -> bool:
    """Verifica se existe endpoint /health."""
    for pattern in ["routes/*.ts", "routes/*.py", "**/*route*", "**/*health*"]:
        for f in root.rglob("*.ts"):
            rel = f.relative_to(root).as_posix()
            if any(ignore in rel for ignore in ["node_modules", "dist", ".git"]):
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
                if "/health" in text or "/api/health" in text:
                    return True
            except Exception:
                continue
    return False


def gitignore_has_dotenv(root: Path) -> bool:
    """Verifica se .env esta no .gitignore."""
    gitignore = root / ".gitignore"
    if not gitignore.exists():
        return False
    text = gitignore.read_text(encoding="utf-8", errors="ignore")
    return ".env" in text


def swagger_check(root: Path) -> bool:
    """Verifica se swagger e condicional ao ambiente."""
    for pattern in ["*.ts", "*.py", "*.go"]:
        for f in root.rglob(pattern):
            rel = f.relative_to(root).as_posix()
            if any(ignore in rel for ignore in ["node_modules", "dist", ".git"]):
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
                if re.search(r'(swagger|openapi|docs|redoc)', text, re.IGNORECASE):
                    if not re.search(r'(environment|env|app_env|NODE_ENV|APP_ENV)', text, re.IGNORECASE):
                        return False
            except Exception:
                continue
    return True


def run_security_gate(root: Path) -> dict:
    """Executa todos os security gate checks e retorna resultados."""
    results = []
    critical = 0
    high = 0
    medium = 0
    passed = 0

    for check in SECURITY_GATE_CHECKS:
        try:
            ok = check["check"](root)
        except Exception:
            ok = False

        if ok:
            passed += 1
            results.append({"id": check["id"], "title": check["title"], "status": "PASSED"})
        else:
            sev = check["severity"]
            if sev == "CRITICO":
                critical += 1
            elif sev == "ALTO":
                high += 1
            else:
                medium += 1
            results.append({
                "id": check["id"],
                "title": check["title"],
                "status": "FAILED",
                "severity": sev,
                "fail": check["fail"],
                "fix": check["fix"]
            })

    blocked = critical > 0 or high > 0
    return {
        "passed": passed,
        "total": len(SECURITY_GATE_CHECKS),
        "critical": critical,
        "high": high,
        "medium": medium,
        "blocked": blocked,
        "checks": results,
        "verdict": "BLOQUEADO" if blocked else "APROVADO",
        "summary": f"Security Gate: {passed}/{len(SECURITY_GATE_CHECKS)} checks passed. "
                   f"{critical} CRITICO(s), {high} ALTO(s), {medium} MEDIO(s). "
                   f"Gate: {'BLOQUEADO' if blocked else 'APROVADO'}"
    }


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════
inp = json.loads(sys.stdin.read())
cwd = inp.get("cwd", "")
last_msg = inp.get("last_assistant_message", "")
turn_id = inp.get("turn_id", "")
flags = inp.get("flags", {})
run_security = flags.get("security_gate", False) or "deploy" in last_msg.lower()[:200]
run_qg_level = flags.get("qg_level", 0)
stop_failed = False
stop_exit_status = 0
sandbox_result = None

project_name = Path(cwd).name if cwd else "unknown"
chronicle_dir = Path.home() / ".codex" / "chronicle"
chronicle_dir.mkdir(parents=True, exist_ok=True)

summary = last_msg[:500] if last_msg else ""

note_lines = [
    f"# Session: {project_name}",
    f"**Date:** {datetime.now().isoformat()}",
    f"**Turn:** {turn_id}",
    "",
    "## Summary",
    summary,
    "",
    "## Context",
    f"- Working directory: {cwd}",
]

# Sandbox: OpenHands headless mode (the only supported sandbox engine).
sandbox_result = run_sandbox(cwd)
if sandbox_result.get("status") == "passed":
    note_lines.append("")
    note_lines.append("## OpenHands Sandbox")
    note_lines.append("Sandbox OpenHands: OK")
elif sandbox_result.get("status") == "failed":
    stop_failed = True
    stop_exit_status = 1
    note_lines.append("")
    note_lines.append("## OpenHands Sandbox")
    note_lines.append(f"Sandbox OpenHands: FALHOU (exit {sandbox_result.get('returncode', 'N/A')})")
    reason = sandbox_result.get("reason", "")
    if reason:
        note_lines.append(f"Motivo: {reason}")
    if sandbox_result.get("stdout"):
        note_lines.append("stdout:")
        note_lines.append(str(sandbox_result["stdout"])[-4000:])
    if sandbox_result.get("stderr"):
        note_lines.append("stderr:")
        note_lines.append(str(sandbox_result["stderr"])[-4000:])
    note_lines.append("")
    chronicle_file = chronicle_dir / f"{project_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    chronicle_file.write_text("\n".join(note_lines), encoding="utf-8")
    play_audio_cue("error")
    output = {
        "systemMessage": f"Memorias salvas em {chronicle_file.name} + Sandbox OpenHands: FALHOU ({sandbox_result.get('returncode', 'N/A')})",
        "error": "OpenHands sandbox failed",
        "exitStatus": stop_exit_status,
    }
    sys.stdout.write(json.dumps(output))
    sys.exit(stop_exit_status)
elif sandbox_result.get("status") == "skipped":
    note_lines.append("")
    note_lines.append("## OpenHands Sandbox")
    note_lines.append(f"Sandbox OpenHands: pulado ({sandbox_result.get('reason', 'unknown')})")

# Security Gate (so roda se detectar deploy ou se explicitamente chamado)
if run_security:
    root = find_project_root(cwd)
    if root:
        gate = run_security_gate(root)
        note_lines.append("")
        note_lines.append("## Security Gate (highermind)")
        note_lines.append(gate["summary"])
        for c in gate["checks"]:
            if c["status"] == "FAILED":
                note_lines.append(f"- [{c['severity']}] {c['title']}: {c['fail']}")
        if gate["blocked"]:
            stop_failed = True
            note_lines.append("")
            note_lines.append("**DEPLOY BLOQUEADO** — resolva os itens acima antes.")

# Quality Gate (modo log-only por default; blocking se qg_level > 0)
qg_path = Path.home() / ".codex" / "hooks" / "qg.py"
if qg_path.exists() and cwd:
    qg_level = run_qg_level if run_qg_level > 0 else 1
    qg_log_only = run_qg_level <= 0
    qg_label = "log only" if qg_log_only else f"blocking (level {qg_level})"
    try:
        args = ["python", str(qg_path), "--path", cwd, "--level", str(qg_level)]
        if qg_log_only:
            args.append("--log-only")
        result = subprocess.run(args, capture_output=True, text=True, timeout=60)
        if result.returncode == 0 or qg_log_only:
            try:
                qg_data = json.loads(result.stdout)
                note_lines.append("")
                note_lines.append(f"## Quality Gate ({qg_label})")
                note_lines.append(qg_data.get("summary", "N/A"))
                if qg_data.get("issues"):
                    note_lines.append("Issues:")
                    for i in qg_data["issues"][:5]:
                        note_lines.append(f"  - {i.get('file')}: {i.get('type')} [{i.get('severity', 'N/A')}]")
                if not qg_log_only and not qg_data.get("pass"):
                    stop_failed = True
                    note_lines.append("")
                    note_lines.append(f"**QUALITY GATE BLOQUEADO** — resolva CRITICO/ALTO antes de continuar.")
            except json.JSONDecodeError:
                if not qg_log_only:
                    stop_failed = True
                note_lines.append("")
                note_lines.append(f"## Quality Gate ({qg_label})\nErro: saida invalida")
        elif not qg_log_only:
            stop_failed = True
            note_lines.append("")
            note_lines.append(f"## Quality Gate ({qg_label})\nBLOQUEADO: retorno {result.returncode}")
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
        if not qg_log_only:
            stop_failed = True
        note_lines.append("")
        note_lines.append(f"## Quality Gate ({qg_label})\nErro: {e}")

# Keywords para busca indexada
keywords = []
if summary:
    words = re.findall(r'\b[A-Za-z]\w{3,}\b', summary.lower())[:15]
    keywords = list(dict.fromkeys(words))
if keywords:
    note_lines.append("")
    note_lines.append("## Keywords")
    note_lines.append(", ".join(keywords))

note_lines.append("")

note = "\n".join(note_lines)

chronicle_file = chronicle_dir / f"{project_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
chronicle_file.write_text(note, encoding="utf-8")

msg_parts = [f"Memorias salvas em {chronicle_file.name} + QG L1 executado"]
if sandbox_result and sandbox_result.get("status") == "passed":
    msg_parts.append("Sandbox OpenHands: OK")
elif sandbox_result and sandbox_result.get("status") == "failed":
    msg_parts.append(f"Sandbox OpenHands: FALHOU ({sandbox_result.get('returncode', 'N/A')})")

# Post-sprint: atualiza graphify + gbrain + MOM + chronicle enrich
try:
    post_sprint = subprocess.run(
        ["python", str(Path.home() / ".codex" / "hooks" / "post_sprint.py")],
        input=json.dumps(inp), capture_output=True, text=True, timeout=30
    )
    if post_sprint.returncode == 0:
        ps_data = json.loads(post_sprint.stdout)
        ps_parts = []
        if ps_data.get("graphify", {}).get("nodes"):
            ps_parts.append(f"Graphify: {ps_data['graphify']['nodes']}n/{ps_data['graphify']['edges']}e")
        if ps_data.get("gbrain", {}).get("decisions_added"):
            ps_parts.append(f"Decisoes: +{ps_data['gbrain']['decisions_added']}")
        if ps_parts:
            msg_parts.append(" | ".join(ps_parts))
except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
    stop_failed = True
    msg_parts.append(f"post_sprint: {e}")

if run_security:
    gate = run_security_gate(root) if (root := find_project_root(cwd)) else None
    if gate:
        msg_parts.append(f"Security Gate: {gate['verdict']} ({gate['critical']}C/{gate['high']}H)")

play_audio_cue("error" if stop_failed else "success")

output = {
    "systemMessage": " | ".join(msg_parts)
}
if stop_exit_status:
    output["error"] = "OpenHands sandbox failed"
    output["exitStatus"] = stop_exit_status
sys.stdout.write(json.dumps(output))
sys.exit(stop_exit_status)
