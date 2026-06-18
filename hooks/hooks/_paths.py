from pathlib import Path
import shutil
import os

HOOKS_DIR = Path(__file__).parent
GSTACK_DIR = Path.home() / ".gstack"
CODEX_DIR = Path.home() / ".codex"
GSTACK_VIBEHARD_DIR = Path.home() / ".gstack_vibehard"
MOM_DB_PATH = Path.home() / ".mom" / "mom.db"


def find_gstack_root(cwd, max_depth=30):
    """Sobe a árvore a partir de `cwd` procurando um projeto gstack (`.gstack/`).

    É a chave da ATIVAÇÃO POR PROJETO: a infra dos hooks é global, mas as regras
    gstack (chronicle, gates, identidade) só agem onde existe `.gstack/`. Projeto
    alheio (sem `.gstack/`) → retorna None → hooks ficam passivos. Retorna o Path
    do root do projeto gstack, ou None.
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
            # IMPORTANTE: `~/.gstack` é o dir GLOBAL do gstack (chronicle/hooks), NÃO
            # um marcador de projeto. Ignorar o próprio home evita que TODO projeto
            # sob a home pareça "gstack-ativo" (falso positivo que furaria o gate).
            if d != home and (d / ".gstack").is_dir():
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
