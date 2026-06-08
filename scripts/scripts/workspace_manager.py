#!/usr/bin/env python3
"""Workspace manager for isolated agent worktrees.

Creates feature worktrees in .claude/worktrees/<feature> and copies selected
local-only files declared in .worktreeinclude. This keeps concurrent agents from
editing the same checkout while preserving required local credentials.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


DEFAULT_INCLUDE_FILE = ".worktreeinclude"
DEFAULT_WORKTREE_ROOT = Path(".claude") / "worktrees"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage GStack agent worktrees")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="Create a new isolated feature worktree")
    create.add_argument("feature", help="Feature name, e.g. feature-api")
    create.add_argument("--repo", default=".", help="Repository root or any path inside it")
    create.add_argument("--branch", help="Branch name. Defaults to agent/<feature>")
    create.add_argument("--base", default="HEAD", help="Base ref for git worktree add")
    create.add_argument("--include-file", default=DEFAULT_INCLUDE_FILE, help="Include file relative to repo root")
    create.add_argument("--dry-run", action="store_true", help="Print planned operations only")
    return parser.parse_args()


def run_git(repo: Path, args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if check and completed.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {completed.stderr.strip() or completed.stdout.strip()}")
    return completed


def find_repo(path: Path) -> Path:
    completed = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=path,
        capture_output=True,
        text=True,
        timeout=15,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"Not a git repository: {path}")
    return Path(completed.stdout.strip()).resolve()


def sanitize_feature(name: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip()).strip(".-_").lower()
    if not value:
        raise ValueError("Feature name cannot be empty after sanitization")
    return value


def read_include_patterns(repo: Path, include_file: str) -> tuple[list[str], list[str]]:
    file_path = repo / include_file
    if not file_path.exists():
        return [], []
    includes: list[str] = []
    excludes: list[str] = []
    for line in file_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("!"):
            excludes.append(stripped[1:])
        else:
            includes.append(stripped)
    return includes, excludes


def is_excluded(relative: str, excludes: list[str]) -> bool:
    return any(fnmatch.fnmatch(relative, pattern) for pattern in excludes)


def expand_include_files(repo: Path, includes: list[str], excludes: list[str]) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for pattern in includes:
        matches = sorted(repo.glob(pattern))
        for match in matches:
            if not match.is_file():
                continue
            relative = match.relative_to(repo).as_posix()
            if is_excluded(relative, excludes):
                continue
            if match in seen:
                continue
            seen.add(match)
            files.append(match)
    return files


def copy_included_files(repo: Path, worktree: Path, include_file: str) -> list[str]:
    includes, excludes = read_include_patterns(repo, include_file)
    copied: list[str] = []
    for source in expand_include_files(repo, includes, excludes):
        relative = source.relative_to(repo)
        target = worktree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied.append(relative.as_posix())
    return copied


def create_worktree(args: argparse.Namespace) -> dict[str, object]:
    repo = find_repo(Path(args.repo).resolve())
    feature = sanitize_feature(args.feature)
    branch = args.branch or f"agent/{feature}"
    worktree = repo / DEFAULT_WORKTREE_ROOT / feature

    if worktree.exists():
        raise RuntimeError(f"Worktree already exists: {worktree}")

    git_args = ["worktree", "add", str(worktree), "-b", branch, args.base]
    if args.dry_run:
        copied = [p.relative_to(repo).as_posix() for p in expand_include_files(repo, *read_include_patterns(repo, args.include_file))]
        return {
            "feature": feature,
            "branch": branch,
            "worktree": str(worktree),
            "copied": copied,
            "dry_run": True,
            "git": ["git", *git_args],
        }

    run_git(repo, git_args)
    copied = copy_included_files(repo, worktree, args.include_file)
    return {
        "feature": feature,
        "branch": branch,
        "worktree": str(worktree),
        "copied": copied,
        "dry_run": False,
    }


def main() -> None:
    args = parse_args()
    try:
        if args.command == "create":
            result = create_worktree(args)
        else:
            raise RuntimeError(f"Unsupported command: {args.command}")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        sys.exit(1)

    print(json.dumps({"ok": True, **result}, indent=2))


if __name__ == "__main__":
    main()
