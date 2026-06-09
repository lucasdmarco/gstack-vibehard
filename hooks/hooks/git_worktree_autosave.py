#!/usr/bin/env python3
"""Auto-save checkpoint for worktrees.

Called by stop.py at session end. Finds all worktrees in the project
and commits uncommitted changes as an auto-save checkpoint.

This prevents data loss if the user closes an Agent View worktree
(Ctrl+X) before pushing/merging.

Pattern: gstack-worktree-autosave
"""
import json, os, subprocess, sys
from pathlib import Path


def find_worktrees(root: Path) -> list[Path]:
    """Find worktree dirs by scanning .git/worktrees/ or calling git worktree list."""
    git_dir = root / ".git"
    worktrees = []

    # Method 1: .git/worktrees/ directory
    wt_dir = git_dir / "worktrees"
    if wt_dir.exists():
        for entry in wt_dir.iterdir():
            gitdir_file = entry / "gitdir"
            if gitdir_file.exists():
                try:
                    wt_path = gitdir_file.read_text(encoding="utf-8").strip()
                    if wt_path:
                        worktrees.append(Path(wt_path).parent)
                except OSError:
                    pass

    # Method 2: git worktree list
    if not worktrees:
        try:
            result = subprocess.run(
                ["git", "worktree", "list", "--porcelain"],
                capture_output=True, text=True, timeout=15, cwd=str(root)
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    if line.startswith("worktree "):
                        wt_path = line[len("worktree "):].strip()
                        p = Path(wt_path)
                        if p != root:
                            worktrees.append(p)
        except (OSError, subprocess.TimeoutExpired):
            pass

    return worktrees


SAFE_EXTENSIONS = {".py", ".js", ".ts", ".tsx", ".jsx", ".md", ".json",
                   ".yaml", ".yml", ".toml", ".css", ".html", ".sh", ".ps1",
                   ".go", ".rs", ".java", ".rb", ".php", ".c", ".cpp", ".h",
                   ".sql", ".env.example"}
UNSAFE_PREFIXES = {".env", ".env.", "node_modules", "dist", ".git"}
UNSAFE_FILES = {".env", ".dockerignore"}


def _is_safe_path(rel_path: str) -> bool:
    """Check if a file is safe to stage (no secrets, no build artifacts)."""
    rel_lower = rel_path.lower()
    for prefix in UNSAFE_PREFIXES:
        if rel_lower.startswith(prefix) or ("/" + prefix) in rel_lower:
            return False
    basename = Path(rel_path).name
    if basename in UNSAFE_FILES:
        return False
    ext = Path(rel_path).suffix
    if ext in SAFE_EXTENSIONS:
        return True
    return False


def autosave_worktree(wt_path: Path) -> dict:
    """Commit any uncommitted changes in the worktree as an auto-save checkpoint.

    Only stages safe file types (.py, .js, .ts, .md, .json, etc.)
    and never stages .env, .dockerignore, node_modules/, or dist/.

    Returns dict with status and commit info.
    """
    if not wt_path.exists():
        return {"path": str(wt_path), "status": "skipped", "reason": "path not found"}

    try:
        # Check for changes
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=15, cwd=str(wt_path)
        )
        if status.returncode != 0 or not status.stdout.strip():
            return {"path": str(wt_path), "status": "clean", "reason": "no changes"}

        # Parse changed files and stage only safe paths
        safe_paths = []
        has_staged = False
        for line in status.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            prefix = line[:2]
            path_part = line[3:].strip()
            # Handle renamed/copied: "R  old -> new"
            if " -> " in path_part and prefix[0] in "RC":
                path_part = path_part.split(" -> ")[-1].strip()
            if _is_safe_path(path_part):
                safe_paths.append(path_part)
            if prefix[0] != " " and prefix[0] != "?":
                has_staged = True

        if not safe_paths and not has_staged:
            return {"path": str(wt_path), "status": "clean", "reason": "no safe changes"}

        if safe_paths:
            subprocess.run(
                ["git", "add", "--"] + safe_paths,
                capture_output=True, text=True, timeout=30, cwd=str(wt_path)
            )

        # Commit (even if only previously staged changes exist)
        commit = subprocess.run(
            ["git", "commit", "-m", "gstack auto-save agent checkpoint",
             "--allow-empty", "--no-verify"],
            capture_output=True, text=True, timeout=30, cwd=str(wt_path)
        )

        if commit.returncode == 0:
            sha = commit.stdout.splitlines()[-1] if commit.stdout else "unknown"
            return {"path": str(wt_path), "status": "committed", "sha": sha}
        return {"path": str(wt_path), "status": "failed", "reason": commit.stderr[:200]}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"path": str(wt_path), "status": "error", "reason": str(e)}


def autosave_all_worktrees(cwd: str) -> list[dict]:
    """Find and auto-save all worktrees reachable from cwd."""
    if not cwd:
        return [{"status": "skipped", "reason": "cwd missing"}]

    root = Path(cwd).resolve()
    for _ in range(5):
        if (root / ".git").exists():
            break
        root = root.parent
    else:
        return [{"status": "skipped", "reason": "no .git found"}]

    worktrees = find_worktrees(root)
    results = []
    for wt in worktrees:
        result = autosave_worktree(wt)
        results.append(result)

    # Always also autosave the main repo
    main_result = autosave_worktree(root)
    results.append(main_result)

    return results


def main():
    cwd = os.environ.get("GSTACK_CWD", "")
    results = autosave_all_worktrees(cwd)
    committed = [r for r in results if r.get("status") == "committed"]
    if committed:
        sys.stderr.write(f"[worktree-autosave] salvou {len(committed)} worktree(s)\n")
        for r in committed:
            sys.stderr.write(f"  {r['path']}: {r.get('sha', '?')[:12]}\n")


if __name__ == "__main__":
    main()
