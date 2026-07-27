#!/usr/bin/env python3
"""Print a reproducible production TypeScript census for apps/frontend."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_ROOT = REPO_ROOT / "apps" / "frontend"
SOURCE_SUFFIXES = {".ts", ".tsx"}
EXCLUDED_DIRS = {".vite", "node_modules", "out", "output", "release"}
EXCLUDED_PATH_PARTS = {"fixtures", "__fixtures__", "__tests__", "tests", "spec"}
THRESHOLDS = (300, 500, 700, 1000, 2000)


def is_production_source(path: Path) -> bool:
    relative = path.relative_to(FRONTEND_ROOT)
    if path.suffix not in SOURCE_SUFFIXES:
        return False
    if path.name.endswith(".d.ts") or ".test." in path.name or ".spec." in path.name:
        return False
    if any(part in EXCLUDED_DIRS or part in EXCLUDED_PATH_PARTS for part in relative.parts):
        return False
    return True


def line_count(path: Path) -> int:
    # Keep the historical newline-count metric instead of splitlines().
    return path.read_bytes().count(b"\n")


def main() -> None:
    files = sorted(path for path in FRONTEND_ROOT.rglob("*") if path.is_file() and is_production_source(path))
    counts = Counter(
        "root" if len(path.relative_to(FRONTEND_ROOT).parts) == 1 else path.relative_to(FRONTEND_ROOT).parts[0]
        for path in files
    )
    line_counts = {str(path.relative_to(REPO_ROOT)): line_count(path) for path in files}
    over_threshold = {
        str(threshold): sum(lines > threshold for lines in line_counts.values())
        for threshold in THRESHOLDS
    }
    payload = {
        "metric": "newline-count",
        "root": str(FRONTEND_ROOT.relative_to(REPO_ROOT)),
        "filters": {
            "suffixes": sorted(SOURCE_SUFFIXES),
            "exclude_files": ["*.d.ts", "*.test.*", "*.spec.*"],
            "exclude_path_parts": sorted(EXCLUDED_DIRS | EXCLUDED_PATH_PARTS),
        },
        "total": len(files),
        "by_top_level_directory": dict(sorted(counts.items())),
        "over_threshold": over_threshold,
        "largest_files": [
            {"path": path, "lines": lines}
            for path, lines in sorted(line_counts.items(), key=lambda item: (-item[1], item[0]))[:20]
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
