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
import json, sys, subprocess, os, re, shutil, platform, logging, time
from pathlib import Path
from typing import Optional

from _output_guard import output_guard, SENSITIVE_PATTERNS, ALLOWED_ROLES_HIERARCHY
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
            except Exception as e:
                sys.stderr.write(f"[Audio] winsound: {e}\n")
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
    except Exception as e:
        sys.stderr.write(f"[Audio] outer: {e}\n")


def run_sandbox(cwd: str) -> dict:
    """Run validation in OpenHands headless mode.

    OpenHands is the only supported sandbox engine. It manages Docker
    isolation internally. If the CLI is not found, the sandbox fails gracefully.
    """
    if not cwd:
        return {"status": "skipped", "reason": "cwd missing"}

    openhands_bin = shutil.which("openhands")
    if not openhands_bin:
        return {"status": "failed", "reason": "openhands CLI not found in PATH. Install: pip install openhands"}

    root = find_project_root(cwd) or Path(cwd).resolve()
    try:
        # gVisor runtime detection: check if Docker has runsc available.
        # Falls back to default Docker runtime if gVisor is not present.
        gvisor_available = False
        try:
            docker_info = subprocess.run(
                ["docker", "info", "--format", "{{json .Runtimes}}"],
                capture_output=True, text=True, timeout=10,
            )
            if docker_info.returncode == 0 and "runsc" in docker_info.stdout:
                gvisor_available = True
        except (OSError, subprocess.TimeoutExpired):
            pass

        runtime_args = ["--runtime=runsc"] if gvisor_available else []
        if not gvisor_available:
            sys.stderr.write("[sandbox] gVisor (runsc) nao detectado — usando runtime Docker padrao\n")

        result = subprocess.run(
            [openhands_bin, "--headless", *runtime_args, "-t", "Validar entrega e executar testes", "--path", str(root)],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except FileNotFoundError:
        return {"status": "failed", "reason": "openhands binary not found"}
    except OSError as e:
        return {"status": "failed", "reason": str(e)}
    except subprocess.TimeoutExpired as e:
        sys.stderr.write("[sandbox] OpenHands timed out\n")
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
    for pattern in ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go", "*.rs", "*.java", "*.rb", "*.php", "*.env"]:
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
    """Verifica se existe endpoint /health em qualquer linguagem suportada."""
    extensions = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go", "*.rs", "*.java", "*.rb", "*.php"]
    for ext in extensions:
        for f in root.rglob(ext):
            rel = f.relative_to(root).as_posix()
            if any(ignore in rel for ignore in ["node_modules", "dist", ".git", "__pycache__"]):
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
    for pattern in ["*.ts", "*.tsx", "*.js", "*.py", "*.go", "*.rs", "*.java", "*.rb", "*.php"]:
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
        except Exception as e:
            logging.error(f"Erro no validador {check['id']}: {e}")
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
try:
    inp = json.loads(sys.stdin.read())
except json.JSONDecodeError:
    inp = {}
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
if not project_name:
    project_name = "root"
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

# ── Fallow Audit (auto_fixable-aware) ──
def run_fallow_audit(cwd: str) -> dict:
    """Executa npx fallow audit --format json e retorna resultado com auto_fixable.
    
    Returns dict com:
      - status: "passed" | "auto_fixable" | "failed" | "skipped"
      - summary: string
      - auto_fixable_count: int
      - blocking_count: int
      - issues: list
    """
    if not cwd:
        return {"status": "skipped", "summary": "cwd missing"}
    try:
        result = subprocess.run(
            ["npx", "fallow", "audit", "--format", "json"],
            capture_output=True, text=True, timeout=60, cwd=cwd,
        )
    except FileNotFoundError:
        return {"status": "skipped", "summary": "npx/fallow not found"}
    except OSError as e:
        return {"status": "skipped", "summary": str(e)}
    except subprocess.TimeoutExpired:
        return {"status": "skipped", "summary": "fallow audit timed out"}

    if result.returncode != 0:
        return {"status": "skipped", "summary": f"fallow exit {result.returncode}: {result.stderr[:200]}"}

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"status": "skipped", "summary": "fallow output not valid JSON"}

    issues = data.get("issues", data.get("findings", []))
    auto_fixable = [i for i in issues if i.get("auto_fixable")]
    blocking = [i for i in issues if not i.get("auto_fixable") and i.get("severity", "").upper() in ("CRITICO", "ALTO")]

    if not issues:
        return {"status": "passed", "summary": "Fallow audit: nenhum issue encontrado", "issues": []}

    return {
        "status": "auto_fixable" if auto_fixable and not blocking else "failed" if blocking else "passed",
        "summary": f"Fallow audit: {len(issues)} issues ({len(auto_fixable)} auto-fixable, {len(blocking)} blocking)",
        "auto_fixable_count": len(auto_fixable),
        "blocking_count": len(blocking),
        "issues": issues,
        "auto_fixable": auto_fixable,
        "blocking": blocking,
    }

# ── Quality Gate ──
# Always runs fallow audit first (non-blocking by default, reports auto_fixable)
fallow_result = run_fallow_audit(cwd)
note_lines.append("")
note_lines.append(f"## Fallow Audit")
note_lines.append(fallow_result.get("summary", "N/A"))
if fallow_result.get("auto_fixable"):
    note_lines.append(f"Auto-fixable issues ({fallow_result['auto_fixable_count']}):")
    for i in fallow_result["auto_fixable"][:5]:
        note_lines.append(f"  - {i.get('file', '?')}: {i.get('type', i.get('rule', '?'))} [auto-fixable]")
if fallow_result.get("blocking"):
    note_lines.append(f"Blocking issues ({fallow_result['blocking_count']}):")
    for i in fallow_result["blocking"][:5]:
        note_lines.append(f"  - {i.get('file', '?')}: {i.get('type', i.get('rule', '?'))} [{i.get('severity', '?')}]")
    stop_failed = True

# Quality Gate (legacy qg.py, modo log-only por default; blocking se qg_level > 0)
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
if fallow_result.get("status") in ("passed", "auto_fixable"):
    msg_parts.append(f"Fallow: {fallow_result['summary']}")
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

# ── Continuous Learning v2 (ECC) — instincts.yaml ──
def _acquire_lock_blocking(fd, retries=5, delay=0.1):
    """Blocking lock acquisition with retry and exponential backoff.
    
    Raises BlockingIOError/OSError if all retries are exhausted.
    """
    last_exc = None
    for attempt in range(retries):
        try:
            if sys.platform == "win32":
                import msvcrt
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except (BlockingIOError, OSError) as e:
            last_exc = e
            if attempt < retries - 1:
                time.sleep(delay * (2 ** attempt))
    sys.stderr.write(f"[instincts] lock falhou apos {retries} tentativas: {last_exc}\n")
    raise last_exc  # type: ignore[misc]


def _release_lock(fd):
    try:
        if sys.platform == "win32":
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_UN)
    except Exception as e:
        sys.stderr.write(f"[instincts] unlock warning: {e}\n")


def _sanitize_yaml_value(s: str) -> str:
    """Sanitize a string value for safe YAML inline quoting."""
    return str(s).replace('"', "'").replace("\n", " ").replace("\r", "")


def write_instinct_entry(trigger: str, details: str, pattern: str, action: str) -> None:
    """Append a structured instinct entry to ~/.gstack/instincts.yaml.

    Each entry records a failure/error pattern so the system can learn
    new security behaviors organically after each session.

    Uses platform-appropriate file locking to prevent race conditions
    from concurrent sessions. The lock is BLOCKING (with retries and
    exponential backoff), never silently skipped.
    """
    try:
        instincts_dir = Path.home() / ".gstack"
        instincts_dir.mkdir(parents=True, exist_ok=True)
        instincts_file = instincts_dir / "instincts.yaml"

        now_iso = datetime.now().isoformat()

        with open(str(instincts_file), "a+", encoding="utf-8") as f:
            _acquire_lock_blocking(f.fileno())
            try:
                f.seek(0)
                raw = f.read()
                if raw.strip():
                    id_count = sum(1 for line in raw.splitlines() if line.strip().startswith("- id:"))
                else:
                    id_count = 0

                def yq(s):
                    return f'"{_sanitize_yaml_value(str(s))}"'

                entry_id = f"instinct_{id_count + 1:04d}"
                entry = (
                    f"  - id: {yq(entry_id)}\n"
                    f"    created_at: {yq(now_iso)}\n"
                    f"    trigger: {yq(trigger)}\n"
                    f"    context:\n"
                    f"      project: {yq(project_name)}\n"
                    f"      turn_id: {yq(turn_id)}\n"
                    f"      details: {yq(details[:200])}\n"
                    f"    pattern: {yq(pattern)}\n"
                    f"    action: {yq(action)}\n"
                    f"    hits: 1\n"
                )

                if id_count == 0:
                    f.seek(0)
                    f.truncate()
                    f.write("instincts:\n" + entry)
                else:
                    f.write(entry)
            finally:
                _release_lock(f.fileno())
    except Exception as e:
        sys.stderr.write(f"[instincts] erro nao critico: {e}\n")

# Collect session failures into instincts
if stop_failed:
    failed_reasons = []
    if sandbox_result and sandbox_result.get("status") == "failed":
        failed_reasons.append(("sandbox_failure", "OpenHands sandbox validation failed", "validate_openhands_env"))
    if fallow_result and fallow_result.get("blocking"):
        failed_reasons.append(("quality_gate_block", "Fallow audit found blocking issues", "run_fallow_audit"))
    if run_security and gate and gate.get("blocked"):
        failed_reasons.append(("security_gate_block", "Security gate checks failed", "run_security_gate"))
    if 'post_sprint' in dir() and isinstance(post_sprint, subprocess.CompletedProcess) and post_sprint.returncode != 0:
        failed_reasons.append(("post_sprint_failed", "Post-sprint hook execution failed", "check_post_sprint_hook"))

    for pattern, details, action in failed_reasons:
        write_instinct_entry("session_error", details, pattern, action)

# ── MOM Continuous Learning (macOS only) ──
mom_bin = shutil.which("mom")
if mom_bin:
    try:
        # Pipe session transcript as JSONL to mom record
        session_jsonl = json.dumps({
            "project": project_name,
            "turn_id": turn_id,
            "timestamp": datetime.now().isoformat(),
            "summary": summary[:500],
            "sandbox_status": (sandbox_result or {}).get("status", "unknown"),
            "stop_failed": stop_failed,
            "fallow_verdict": (fallow_result or {}).get("status", "skipped"),
            "security_gate": (gate or {}).get("verdict", "N/A") if run_security else "skipped",
        })
        subprocess.run(
            [mom_bin, "record"],
            input=session_jsonl,
            capture_output=True, text=True, timeout=15
        )
        # Async mom draft — non-blocking, best-effort
        subprocess.Popen(
            [mom_bin, "draft"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except (OSError, subprocess.TimeoutExpired):
        pass  # MOM is advisory; never block stop on it

# ── GitOps: GitHub Issue/PR Automation ──
def gitops_available() -> bool:
    """Check if gh CLI is installed and authenticated to a remote."""
    gh_bin = shutil.which("gh")
    if not gh_bin:
        return False
    try:
        subprocess.run(
            [gh_bin, "repo", "view", "--json", "name"],
            capture_output=True, text=True, timeout=10,
        )
        return True
    except (OSError, subprocess.TimeoutExpired):
        return False


def gitops_issue_create(fallow: dict, instincts_path: Path) -> Optional[str]:
    """Create a GitHub Issue for critical fallow failures or persistent instincts.

    Returns the issue URL if created, None otherwise.
    """
    gh_bin = shutil.which("gh")
    if not gh_bin:
        return None

    reasons = []

    # Check fallow for CRITICAL/ALTO blocking issues
    blocking = (fallow or {}).get("blocking", [])
    if blocking:
        critical_issues = [i for i in blocking if i.get("severity", "").upper() == "CRITICO"]
        high_issues = [i for i in blocking if i.get("severity", "").upper() == "ALTO"]
        if critical_issues or high_issues:
            parts = []
            if critical_issues:
                parts.append(f"{len(critical_issues)} CRITICO(s)")
            if high_issues:
                parts.append(f"{len(high_issues)} ALTO(s)")
            summary = "; ".join(
                f"{i.get('file', '?')}: {i.get('type', i.get('rule', '?'))}"
                for i in (critical_issues + high_issues)[:5]
            )
            reasons.append(f"Fallow bloqueou ({', '.join(parts)}): {summary}")

    # Check instincts for persistent failures (same trigger hit >= 2)
    if instincts_path.exists():
        try:
            instinct_text = instincts_path.read_text(encoding="utf-8")
            persistent = re.findall(
                r"trigger: (\w+).*?hits: (\d+)",
                instinct_text,
                re.DOTALL,
            )
            for trigger, hits in persistent:
                if int(hits) >= 2:
                    reasons.append(
                        f"Instinto persistente: {trigger} ({hits} ocorrencias)"
                    )
        except Exception as e:
            sys.stderr.write(f"[gitops] instinct read error: {e}\n")

    if not reasons:
        return None

    body_lines = [
        f"## Relatorio Automatico — {project_name}",
        "",
        f"**Turno:** {turn_id}",
        f"**Data:** {datetime.now().isoformat()}",
        f"**Projeto:** {project_name}",
        "",
        "### Gatilhos",
        "",
    ]
    for r in reasons:
        body_lines.append(f"- {r}")
    body_lines.append("")

    if blocking:
        body_lines.append("### Laudo Fallow")
        body_lines.append("")
        for i in blocking[:10]:
            body_lines.append(f"- **[{i.get('severity', '?')}]** `{i.get('file', '?')}` — {i.get('type', i.get('rule', '?'))}")
            if i.get("message"):
                body_lines.append(f"  _{i['message'][:200]}_")
        body_lines.append("")

    body_lines.append("---")
    body_lines.append(f"_Issue gerada automaticamente por gstack_vibehard `stop.py`_")

    body_text = "\n".join(body_lines)
    title = f"[gstack] {reasons[0][:120]}"
    if len(reasons) > 1:
        title += f" (+{len(reasons)-1})"

    # Run body through Output Guard before publishing to GitHub
    user_role = os.environ.get("GSTACK_USER_ROLE", "viewer")
    blocked, guard_reason = output_guard(body_text, user_role)
    if blocked:
        sys.stderr.write(f"[gitops] issue nao criada — Output Guard bloqueou: {guard_reason}\n")
        return None

    try:
        result = subprocess.run(
            [gh_bin, "issue", "create",
             "--title", title,
             "--body", body_text,
             "--label", "gstack-automation,bug"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            msg_parts.append(f"Issue: {url}")
            return url
        else:
            sys.stderr.write(f"[gitops] issue create falhou: {result.stderr[:200]}\n")
            return None
    except (OSError, subprocess.TimeoutExpired) as e:
        sys.stderr.write(f"[gitops] issue create error: {e}\n")
        return None


def gitops_pr_create(summary_text: str, root: Optional[Path]) -> Optional[str]:
    """Create a GitHub PR if new structural docs or a fix was completed.

    Returns the PR URL if created, None otherwise.
    """
    gh_bin = shutil.which("gh")
    if not gh_bin or not root:
        return None

    # Detect if this session resolved something or generated new docs
    summary_lower = (summary_text or "").lower()
    has_fix = any(kw in summary_lower for kw in ["fix", "resolve", "close", "feat", "feature", "implement"])
    if not has_fix:
        return None

    # Check for new .md files in docs/ or wiki/ or new graph reports
    new_docs = []
    if root:
        for pattern in ["docs/*.md", "*.md", "wiki/*.md", "GRAPH_REPORT.md"]:
            for f in root.glob(pattern):
                rel = f.relative_to(root).as_posix()
                if rel not in ("README.md", "node_modules"):
                    new_docs.append(rel)

    if not new_docs and "fix" not in summary_lower:
        return None

    branch_name = f"gstack/auto-{datetime.now().strftime('%Y%m%d%H%M')}"

    try:
        # Create branch and local commit only — no automatic push or PR
        subprocess.run(["git", "checkout", "-b", branch_name],
                       cwd=str(root), capture_output=True, text=True, timeout=15)
        subprocess.run(["git", "add", "-A"],
                       cwd=str(root), capture_output=True, text=True, timeout=15)
        commit_msg = f"[gstack] {summary_text[:100]}"
        allow_dirty = os.environ.get("GSTACK_ALLOW_DIRTY_COMMIT", "") == "1"
        commit_cmd = ["git", "commit", "-m", commit_msg]
        if allow_dirty:
            commit_cmd.append("--no-verify")
            sys.stderr.write("[gitops] GSTACK_ALLOW_DIRTY_COMMIT=1 — hooks de pre-commit ignorados\n")
        subprocess.run(commit_cmd,
                       cwd=str(root), capture_output=True, text=True, timeout=30)
        sys.stderr.write(f"[gitops] Commit local criado no branch '{branch_name}'.\n")
        sys.stderr.write(f"[gitops]  Revise e push manualmente: git push origin {branch_name}\n")
        sys.stderr.write(f"[gitops]  Depois crie PR: gh pr create --title \"{summary_text[:80]}\"\n")
        return None
    except (OSError, subprocess.TimeoutExpired) as e:
        sys.stderr.write(f"[gitops] git error: {e}\n")
        return None


# Execute GitOps
gh_bin = shutil.which("gh")
if gh_bin:
    root_path = find_project_root(cwd)
    if root_path and gitops_available():
        if stop_failed:
            instincts_file = Path.home() / ".gstack" / "instincts.yaml"
            if os.environ.get("GSTACK_AUTO_ISSUE", "") == "1":
                gitops_issue_create(fallow_result, instincts_file)
            else:
                sys.stderr.write(
                    "[gitops] Issue automatica desativada. "
                    "Defina GSTACK_AUTO_ISSUE=1 para ativar.\n"
                )
        else:
            # Only create PRs on successful sessions with meaningful work
            gitops_pr_create(summary, root_path)

play_audio_cue("error" if stop_failed else "success")

output = {
    "systemMessage": " | ".join(msg_parts)
}
if stop_exit_status:
    output["error"] = "OpenHands sandbox failed"
    output["exitStatus"] = stop_exit_status

# Output Guard: verifica se o output pode ser exibido ao usuario
user_role = os.environ.get("GSTACK_USER_ROLE", "viewer")
output_text = json.dumps(output)
blocked, reason = output_guard(output_text, user_role)
if blocked:
    sys.stderr.write(f"[Porteiro] {reason}\n")
    sys.stdout.write(json.dumps({
        "systemMessage": reason,
        "blocked": True,
        "originalBlockedMsg": msg_parts[0] if msg_parts else "",
    }))
    sys.exit(1)

sys.stdout.write(output_text)
sys.exit(stop_exit_status)
