"""Repository hygiene checks for submission (Requirements 29.3, 29.8, 33.11).

Checks that no delivered data, ``.env`` file or key-like string is in the repository.

"Tracked files" come from ``git ls-files`` when the folder is a git repository. When git is
unavailable or the folder is not a repository, the checks fall back to walking the working tree
and treating every file outside the ignored folders as a candidate. The fallback is explicit:
``test_tracked_file_source_is_reported`` always runs and states which mode was used.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

# Folders never scanned and never treated as tracked in the fallback.
EXCLUDED_DIRS = {
    ".venv",
    "node_modules",
    "outputs2.0",
    ".git",
    "dist",
    ".hypothesis",
    ".pytest_cache",
    ".ruff_cache",
    "__pycache__",
}
LOCK_FILES = {"uv.lock", "package-lock.json"}
MAX_SCAN_BYTES = 2_000_000

REQUIRED_GITIGNORE = ["outputs2.0/", ".env", "node_modules", ".venv"]
REQUIRED_DOCKERIGNORE = ["outputs2.0/", ".env", "node_modules", ".venv"]

# Conservative key patterns.
KEY_PATTERNS: dict[str, re.Pattern[str]] = {
    "hex32 assigned to key/token/secret variable": re.compile(
        r"""(?ix)
        \b[\w.-]*(?:key|token|secret)[\w.-]*\s*["']?\s*[:=]\s*["']?[0-9a-f]{32}\b(?![0-9a-f])
        """
    ),
    "Hugging Face token": re.compile(r"\bhf_[A-Za-z0-9]{20,}\b"),
}


def _git_tracked_files() -> list[Path] | None:
    """Return tracked files from git, or None when git or the repository is unavailable."""
    if shutil.which("git") is None or not (REPO_ROOT / ".git").exists():
        return None
    try:
        result = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=True,
            timeout=60,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    names = [n for n in result.stdout.decode("utf-8", "replace").split("\0") if n]
    return [REPO_ROOT / n for n in names]


def _working_tree_files() -> list[Path]:
    """Fallback: all files outside the excluded folders."""
    files: list[Path] = []
    for path in REPO_ROOT.rglob("*"):
        rel_parts = path.relative_to(REPO_ROOT).parts
        if any(part in EXCLUDED_DIRS for part in rel_parts):
            continue
        if path.is_file():
            files.append(path)
    return files


def _candidate_files() -> tuple[str, list[Path]]:
    tracked = _git_tracked_files()
    if tracked is not None:
        return "git", tracked
    return "working-tree", _working_tree_files()


def _rel(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def _ignore_entries(name: str) -> set[str]:
    text = (REPO_ROOT / name).read_text(encoding="utf-8")
    return {
        line.strip().lstrip("/")
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def _covers(entries: set[str], required: str) -> bool:
    """True when an ignore entry names the required folder or file (with or without wildcards)."""
    bare = required.rstrip("/")
    accepted = {required, bare, bare + "/", "**/" + bare, "**/" + bare + "/"}
    return bool(accepted & entries)


def test_tracked_file_source_is_reported() -> None:
    """Always runs. States which mode the other checks used, so a fallback is never silent."""
    mode, files = _candidate_files()
    print(f"repo hygiene mode: {mode}; files checked: {len(files)}")
    assert mode in {"git", "working-tree"}
    assert files, "no candidate files found; the hygiene checks would pass vacuously"
    if mode == "working-tree":
        assert not (REPO_ROOT / ".git").exists() or shutil.which("git") is None, (
            "git repository present and git available, but git ls-files failed"
        )


@pytest.mark.parametrize(
    "name,required", [(".gitignore", REQUIRED_GITIGNORE), (".dockerignore", REQUIRED_DOCKERIGNORE)]
)
def test_ignore_files_have_required_entries(name: str, required: list[str]) -> None:
    entries = _ignore_entries(name)
    missing = [r for r in required if not _covers(entries, r)]
    assert not missing, f"{name} is missing entries: {missing}"


def test_env_example_is_not_ignored() -> None:
    assert "!.env.example" in _ignore_entries(".gitignore")
    assert (REPO_ROOT / ".env.example").is_file()


def test_no_delivered_data_tracked() -> None:
    mode, files = _candidate_files()
    offenders = [_rel(p) for p in files if _rel(p).startswith("outputs2.0/")]
    if mode == "working-tree":
        # outputs2.0/ is skipped by the walk, so also look for data files elsewhere in the tree
        # (a copied delivered file outside the ignored folders would be committed).
        offenders += [
            _rel(p) for p in files if p.suffix == ".parquet" or p.name == "DATA_README.md"
        ]
    assert not offenders, f"delivered data would be committed ({mode} mode): {offenders}"


def test_no_env_file_tracked() -> None:
    mode, files = _candidate_files()
    offenders = [
        _rel(p)
        for p in files
        if (p.name == ".env" or p.name.startswith(".env.")) and p.name != ".env.example"
    ]
    assert not offenders, f".env file would be committed ({mode} mode): {offenders}"


def test_no_key_like_strings() -> None:
    mode, files = _candidate_files()
    findings: list[str] = []
    for path in files:
        if path.name in LOCK_FILES or path.name == ".env.example":
            continue
        if any(part in EXCLUDED_DIRS for part in path.relative_to(REPO_ROOT).parts):
            continue
        try:
            if not path.is_file() or path.stat().st_size > MAX_SCAN_BYTES:
                continue
            raw = path.read_bytes()
        except OSError:
            continue
        if b"\0" in raw[:4096]:
            continue  # binary
        text = raw.decode("utf-8", errors="ignore")
        for label, pattern in KEY_PATTERNS.items():
            for match in pattern.finditer(text):
                line_no = text.count("\n", 0, match.start()) + 1
                findings.append(f"{_rel(path)}:{line_no}: {label}")
    assert not findings, f"key-like strings found ({mode} mode): {findings}"


def test_key_patterns_detect_examples() -> None:
    """The scanner must flag obvious leaks, so a pass is meaningful."""
    hex_line = 'MAP_KEY = "' + "a1b2c3d4" * 4 + '"'
    hf_line = "token = hf_" + "A" * 30
    assert KEY_PATTERNS["hex32 assigned to key/token/secret variable"].search(hex_line)
    assert KEY_PATTERNS["Hugging Face token"].search(hf_line)
    assert not KEY_PATTERNS["hex32 assigned to key/token/secret variable"].search(
        "MAP_KEY=your_key_here"
    )
