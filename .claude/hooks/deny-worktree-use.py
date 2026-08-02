#!/usr/bin/env python3
"""Deny Claude tool calls that create, enter, reuse, or touch MYStudio worktrees."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterator


PROJECT_ROOT = Path(
    os.environ.get("CLAUDE_PROJECT_DIR", Path(__file__).resolve().parents[2])
).expanduser().resolve()
FORBIDDEN_ROOT = (PROJECT_ROOT / ".claude" / "worktrees").resolve()
PATH_KEYS = {
    "cwd",
    "directory",
    "destination",
    "destinations",
    "file_path",
    "file_paths",
    "notebook_path",
    "path",
    "paths",
    "target",
    "targets",
}
MISSING = object()


def _deny(reason: str) -> None:
    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(output, ensure_ascii=False))


def _is_within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _resolve_path(value: str, cwd: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = cwd / path
    return path.resolve(strict=False)


def _iter_path_values(value: Any, key: str = "") -> Iterator[str]:
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            yield from _iter_path_values(child_value, str(child_key))
        return
    if isinstance(value, list):
        if key in PATH_KEYS:
            for item in value:
                if isinstance(item, str) and item.strip():
                    yield item
        else:
            for item in value:
                yield from _iter_path_values(item, key)
        return
    if key in PATH_KEYS and isinstance(value, str) and value.strip():
        yield value


def _has_nonempty_isolation(tool_input: dict[str, Any]) -> bool:
    isolation = tool_input.get("isolation", MISSING)
    if isolation is MISSING or isolation is None:
        return False
    if isinstance(isolation, str):
        return bool(isolation.strip())
    return True


def _forbidden_bash_reason(command: str) -> str | None:
    if re.search(r"\bgit\b[^\n;&|]*\bworktree\b", command, re.IGNORECASE):
        return "MYStudio forbids Claude Bash from invoking git worktree."

    claude_worktree = re.search(
        r"\bclaude\b[^\n;&|]*(?:--worktree\b|(?<!\S)-w(?=\s|=|$)|--tmux\b)",
        command,
        re.IGNORECASE,
    )
    if claude_worktree:
        return "MYStudio forbids Claude worktree launch flags (-w/--worktree/--tmux)."

    normalized = command.replace("\\", "/")
    if str(FORBIDDEN_ROOT) in normalized or re.search(
        r"(?:^|[\s'\"])(?:\./)?\.claude/worktrees(?:/|[\s'\"]|$)", normalized
    ):
        return "MYStudio forbids Bash operations targeting .claude/worktrees."
    return None


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        _deny("Malformed PreToolUse JSON; MYStudio worktree policy fails closed.")
        return 0

    if not isinstance(input_data, dict):
        _deny("Invalid PreToolUse payload; MYStudio worktree policy fails closed.")
        return 0

    tool_name = str(input_data.get("tool_name") or input_data.get("toolName") or "")
    raw_tool_input = input_data.get("tool_input", {})
    tool_input = raw_tool_input if isinstance(raw_tool_input, dict) else {}
    raw_cwd = input_data.get("cwd")
    cwd = _resolve_path(raw_cwd, PROJECT_ROOT) if isinstance(raw_cwd, str) else PROJECT_ROOT

    if _is_within(cwd, FORBIDDEN_ROOT):
        _deny("MYStudio forbids running tools from .claude/worktrees.")
        return 0

    if tool_name.lower() in {"agent", "task"} and _has_nonempty_isolation(tool_input):
        _deny("MYStudio Agent/Task calls must omit isolation; every nonempty value is forbidden.")
        return 0

    for path_value in _iter_path_values(tool_input):
        if _is_within(_resolve_path(path_value, cwd), FORBIDDEN_ROOT):
            _deny("MYStudio forbids tool targets inside .claude/worktrees.")
            return 0

    if tool_name.lower() == "bash":
        command = tool_input.get("command", "")
        if isinstance(command, str):
            reason = _forbidden_bash_reason(command)
            if reason:
                _deny(reason)
                return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
