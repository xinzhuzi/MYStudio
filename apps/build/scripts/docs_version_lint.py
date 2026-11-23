#!/usr/bin/env python3
"""docs_version_lint: architecture-doc version anchors (D20 ruling A).

DEVELOPER_ARCHITECTURE.md keeps human-readable exact version numbers for
Remotion, Mediabunny, and Electron. This lint pins each of the three anchors
to its source of truth, so a dependency upgrade that forgets the doc turns
the hygiene gate red immediately:

  - Remotion   <- apps/package.json "remotion"
  - Mediabunny <- apps/package.json "mediabunny"
  - Electron   <- apps/pnpm-lock.yaml resolved "electron@<version>" entry

Anchor = the first backtick-quoted three-part version on the same line that
follows the tool name in the doc. A missing anchor, a missing source, or a
value mismatch is a failure. Reads only; writes no files.

Usage:
  python3 apps/build/scripts/docs_version_lint.py             # lint the repo
  python3 apps/build/scripts/docs_version_lint.py --selftest  # built-in tests
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DOC_PATH = REPO_ROOT / "docs" / "engineering" / "DEVELOPER_ARCHITECTURE.md"
PACKAGE_JSON_PATH = REPO_ROOT / "apps" / "package.json"
LOCKFILE_PATH = REPO_ROOT / "apps" / "pnpm-lock.yaml"

# First `x.y.z` on the same line after the tool name, e.g. "Remotion `4.0.534`".
ANCHOR_TEMPLATE = r"{label}[^`\n]*`(\d+\.\d+\.\d+)`"
# pnpm-lock packages section entry, two-space indented, exact version key.
LOCKFILE_ELECTRON_RE = re.compile(r"(?m)^ {2}electron@(\d+\.\d+\.\d+):$")

ANCHORS = (
    ("Remotion", "package.json:remotion"),
    ("Mediabunny", "package.json:mediabunny"),
    ("Electron", "pnpm-lock.yaml:electron"),
)


def doc_anchor(text: str, label: str) -> str | None:
    """Return the first backtick-quoted version after ``label`` on one line."""
    match = re.search(ANCHOR_TEMPLATE.format(label=label), text)
    return match.group(1) if match else None


def package_version(pkg: dict, name: str) -> str | None:
    """Return the pinned version of ``name`` from a parsed package.json."""
    for section in ("dependencies", "devDependencies"):
        value = pkg.get(section, {}).get(name)
        if isinstance(value, str):
            return value.lstrip("^~")
    return None


def lockfile_electron_version(lock_text: str) -> str | None:
    """Return the resolved electron version from pnpm-lock.yaml text."""
    match = LOCKFILE_ELECTRON_RE.search(lock_text)
    return match.group(1) if match else None


def run_checks(doc_text: str, pkg: dict, lock_text: str) -> list[dict]:
    """Return one {label, doc, source} row per anchor."""
    sources = {
        "package.json:remotion": package_version(pkg, "remotion"),
        "package.json:mediabunny": package_version(pkg, "mediabunny"),
        "pnpm-lock.yaml:electron": lockfile_electron_version(lock_text),
    }
    return [
        {"label": label, "doc": doc_anchor(doc_text, label), "source": sources[key]}
        for label, key in ANCHORS
    ]


def report(results: list[dict]) -> int:
    """Print one PASS/FAIL line per anchor; return the failure count."""
    failures = 0
    for item in results:
        doc_value = item["doc"] if item["doc"] is not None else "<missing>"
        source_value = item["source"] if item["source"] is not None else "<missing>"
        ok = item["doc"] is not None and item["doc"] == item["source"]
        if not ok:
            failures += 1
        status = "PASS" if ok else "FAIL"
        print(f"{status} {item['label']}: doc=`{doc_value}` source=`{source_value}`")
    return failures


def selftest() -> int:
    """Exercise the checker on temp files with known-good and poisoned docs."""
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        pkg_path = tmp_dir / "package.json"
        lock_path = tmp_dir / "pnpm-lock.yaml"
        pkg_path.write_text(
            json.dumps({"dependencies": {"remotion": "4.0.534", "mediabunny": "1.56.1"}}),
            encoding="utf-8",
        )
        lock_path.write_text(
            "packages:\n\n  electron@44.5.1:\n    resolution: {integrity: sha512-x}\n",
            encoding="utf-8",
        )
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        lock_text = lock_path.read_text(encoding="utf-8")

        def check(name: str, condition: bool) -> None:
            nonlocal failures
            if not condition:
                failures += 1
                print(f"selftest FAIL: {name}")

        try:
            good_doc = tmp_dir / "good.md"
            good_doc.write_text(
                "当前固定版本为 Remotion `4.0.534`，Mediabunny 为 `1.56.1`，"
                "Electron `44.5.1` 内置 Node 24，满足\n",
                encoding="utf-8",
            )
            results = run_checks(good_doc.read_text(encoding="utf-8"), pkg, lock_text)
            check(
                "correct doc must pass every anchor",
                all(r["doc"] is not None and r["doc"] == r["source"] for r in results),
            )

            wrong_doc = tmp_dir / "wrong.md"
            wrong_doc.write_text(
                "当前固定版本为 Remotion `4.0.499`，Mediabunny 为 `1.50.8`，"
                "Electron `43.4.0` 内置 Node 24，满足\n",
                encoding="utf-8",
            )
            results = run_checks(wrong_doc.read_text(encoding="utf-8"), pkg, lock_text)
            check(
                "wrong versions must fail every anchor",
                all(r["doc"] is not None and r["doc"] != r["source"] for r in results),
            )

            missing_doc = tmp_dir / "missing.md"
            missing_doc.write_text(
                "Remotion is pinned elsewhere; no Mediabunny or Electron version here.\n",
                encoding="utf-8",
            )
            results = run_checks(missing_doc.read_text(encoding="utf-8"), pkg, lock_text)
            check("missing anchors must fail", all(r["doc"] is None for r in results))
        except NotImplementedError as exc:
            failures += 1
            print(f"selftest FAIL: checker not implemented ({exc})")

    print(f"selftest: {failures} failure(s)")
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Check DEVELOPER_ARCHITECTURE.md version anchors against sources.",
    )
    parser.add_argument(
        "--selftest",
        action="store_true",
        help="run the built-in selftest instead of linting the repo",
    )
    args = parser.parse_args(argv)

    if args.selftest:
        return 1 if selftest() else 0

    doc_text = DOC_PATH.read_text(encoding="utf-8")
    pkg = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))
    lock_text = LOCKFILE_PATH.read_text(encoding="utf-8")
    return 1 if report(run_checks(doc_text, pkg, lock_text)) else 0


if __name__ == "__main__":
    sys.exit(main())
