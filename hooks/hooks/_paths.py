from pathlib import Path
import shutil
import os

HOOKS_DIR = Path(__file__).parent
GSTACK_DIR = Path.home() / ".gstack"
CODEX_DIR = Path.home() / ".codex"


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
        return gstack_path.open(mode, encoding=None if binary else "utf-8").read()
    codex_path = CODEX_DIR / subpath
    if codex_path.exists():
        mode = "rb" if binary else "r"
        return codex_path.open(mode, encoding=None if binary else "utf-8").read()
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
