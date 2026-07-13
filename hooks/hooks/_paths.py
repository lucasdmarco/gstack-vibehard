from pathlib import Path
import json
import shutil
import os
import uuid

HOOKS_DIR = Path(__file__).parent
GSTACK_DIR = Path.home() / ".gstack"
CODEX_DIR = Path.home() / ".codex"
GSTACK_VIBEHARD_DIR = Path.home() / ".gstack_vibehard"
MOM_DB_PATH = Path.home() / ".mom" / "mom.db"

# Marcador CANONICO de projeto ativado (PRD41 S41.2 / PRD40 P0.3). A mera existencia
# de `.gstack/` NAO ativa mais um projeto — um `.gstack` vazado/copiado (ex.: resto de
# teste sob %TEMP%) nao pode injetar identidade/governanca num projeto alheio. So um
# `.gstack/project.json` VALIDO, cujo `root` canonico corresponde ao diretorio, ativa.
PROJECT_MARKER_SCHEMA = "gstack.project.v1"


def _valid_project_marker(gstack_dir, project_root):
    """True se `.gstack/project.json` e um marcador VALIDO cujo root canonico
    corresponde ao diretorio (anti-ativacao por `.gstack` vazado/copiado)."""
    marker = gstack_dir / "project.json"
    try:
        if not marker.is_file():
            return False
        data = json.loads(marker.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("schemaVersion") != PROJECT_MARKER_SCHEMA:
            return False
        declared = data.get("root")
        if not declared:
            return False
        return Path(declared).resolve() == project_root.resolve()
    except Exception:
        return False


def write_project_marker(project_root, *, mode="lite", created_by="gstack_vibehard", project_id=None):
    """Escreve/atualiza o marcador `.gstack/project.json` (migracao explicita de um
    projeto). `root` grava o caminho canonico — mover/copiar a pasta invalida o
    marcador ate re-migrar. Retorna o dict do marcador."""
    root = Path(project_root).resolve()
    gdir = root / ".gstack"
    gdir.mkdir(parents=True, exist_ok=True)
    marker = {
        "schemaVersion": PROJECT_MARKER_SCHEMA,
        "projectId": project_id or str(uuid.uuid4()),
        "root": str(root),
        "mode": mode,
        "activated": True,
        "createdBy": created_by,
    }
    (gdir / "project.json").write_text(json.dumps(marker, indent=2), encoding="utf-8")
    return marker


def find_gstack_root(cwd, max_depth=30):
    """Sobe a árvore a partir de `cwd` procurando um projeto gstack ATIVADO.

    É a chave da ATIVAÇÃO POR PROJETO: a infra dos hooks é global, mas as regras
    gstack (chronicle, gates, identidade) só agem em projeto com marcador CANONICO
    `.gstack/project.json` válido (schema + root correspondente). `.gstack/` genérico
    (vazado/copiado) permanece INERTE → retorna None → hooks passivos (P0.3).
    """
    if not cwd:
        return None
    try:
        d = Path(cwd).resolve()
        home = Path.home().resolve()
    except Exception:
        return None
    for _ in range(max_depth):
        try:
            # `~/.gstack` é o dir GLOBAL do gstack, NÃO um projeto; e um `.gstack/`
            # sem marcador válido (ex.: %TEMP%/.gstack vazado) NUNCA ativa.
            if d != home and _valid_project_marker(d / ".gstack", d):
                return d
        except Exception:
            return None
        if d.parent == d:
            break
        d = d.parent
    return None


def is_gstack_project(cwd):
    """True se `cwd` está dentro de um projeto gstack (tem `.gstack/`)."""
    return find_gstack_root(cwd) is not None


def read_project_profile(cwd):
    """Lê o `.gstack/profile.json` do projeto (arquétipo + modo + dial de token).

    Fail-open: ausente/inválido → defaults seguros (`observe`/`standard`). É o que
    deixa a Camada A (contexto/identidade/memória) escalar por projeto sem pesar.
    """
    defaults = {"profile": "unknown", "mode": "observe", "tokenBudget": "standard"}
    root = find_gstack_root(cwd)
    if not root:
        return defaults
    try:
        p = root / ".gstack" / "profile.json"
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {**defaults, **data}
    except Exception:
        return defaults
    return defaults


def token_budget(cwd):
    """Nível do dial de token do projeto: `minimal` | `standard` | `full`."""
    tb = str(read_project_profile(cwd).get("tokenBudget", "standard")).lower()
    return tb if tb in ("minimal", "standard", "full") else "standard"


def chronicle_dir():
    d = GSTACK_DIR / "chronicle"
    d.mkdir(parents=True, exist_ok=True)
    return d


def sprints_dir():
    d = GSTACK_DIR / "sprints"
    d.mkdir(parents=True, exist_ok=True)
    return d


def read_with_fallback(subpath, binary=False):
    gstack_path = GSTACK_DIR / subpath
    if gstack_path.exists():
        mode = "rb" if binary else "r"
        with gstack_path.open(mode, encoding=None if binary else "utf-8") as f:
            return f.read()
    codex_path = CODEX_DIR / subpath
    if codex_path.exists():
        mode = "rb" if binary else "r"
        with codex_path.open(mode, encoding=None if binary else "utf-8") as f:
            return f.read()
    return None


def hook_support_path(name):
    peer = HOOKS_DIR / name
    if peer.exists():
        return peer
    gstack_hook = GSTACK_DIR / "hooks" / name
    if gstack_hook.exists():
        return gstack_hook
    codex_hook = CODEX_DIR / "hooks" / name
    if codex_hook.exists():
        return codex_hook
    return peer


def migrate_legacy():
    if not CODEX_DIR.exists():
        return False
    if not GSTACK_DIR.exists():
        GSTACK_DIR.mkdir(parents=True, exist_ok=True)
    migrated = False
    for entry in CODEX_DIR.iterdir():
        dst = GSTACK_DIR / entry.name
        if not dst.exists():
            if entry.is_dir():
                shutil.copytree(entry, dst)
            else:
                shutil.copy2(entry, dst)
            migrated = True
    return migrated
