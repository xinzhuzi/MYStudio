"""Read-only baseline audit for the blocked chapter001 apply slice; never writes projects."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4"
PROJECT_ROOT = Path("/Users/zhengbingjin/Project/IP/MA")
TASK = Path(__file__).resolve().parents[3] / ".trellis/tasks/10-25-daojie-director-rule-conflict-validation"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def audit(snapshot_file: Path, registry_file: Path) -> dict:
    snapshot = json.loads(snapshot_file.read_text())
    registry_raw = registry_file.read_bytes()
    projects = json.loads(registry_raw)["state"]["projects"]
    registered = [item for item in projects if item["id"] == PROJECT_ID]
    assert len(registered) == 1 and registered[0]["location"] == str(PROJECT_ROOT), "registered MA location mismatch"
    assert PROJECT_ROOT.resolve() == PROJECT_ROOT, "noncanonical project root"
    assert snapshot["projectId"] == PROJECT_ID and snapshot["chapterId"] == "chapter-001", "wrong project/chapter"
    assert snapshot["projectRoot"] == str(PROJECT_ROOT), "snapshot root mismatch"
    expected = {"store/studio-workflow/manifest.json": snapshot["manifestRaw"]}
    expected.update({"store/studio-workflow/" + item["relativePath"]: item["content"] for item in snapshot["shards"]})
    assert len(snapshot["sourceFiles"]) == len(expected), "sourceFiles count mismatch"
    assert len({item["relativePath"] for item in snapshot["sourceFiles"]}) == len(expected), "duplicate sourceFiles"

    def read(relative: str) -> bytes:
        parts = relative.split("/")
        assert not Path(relative).is_absolute() and all(part not in ("", ".", "..") for part in parts), "unsafe relative path"
        assert "\\" not in relative, "unsafe path separator"
        target = PROJECT_ROOT / relative
        assert target.resolve(strict=True) == target, "noncanonical project file"
        return target.read_bytes()

    for item in snapshot["sourceFiles"]:
        relative = item["relativePath"]
        assert item["realpath"] == str(PROJECT_ROOT / relative), "source realpath mismatch"
        assert digest(expected[relative].encode()) == item["sha256"] == digest(read(relative)), "source baseline changed: " + relative
    manifest_relative = "store/studio-workflow/manifest.json"
    manifest_raw = read(manifest_relative)
    assert digest(manifest_raw) == snapshot["manifestSha256"], "manifest hash changed"
    manifest = json.loads(manifest_raw)
    assert manifest == snapshot["manifest"] and manifest["activeChapterId"] == "chapter-001", "manifest identity changed"
    assert len(manifest["chapterIndex"]) == 4125, "chapter index count mismatch"
    assert len(set(manifest["shards"])) == len(manifest["shards"]), "duplicate shard references"
    rows = []
    for name in manifest["shards"]:
        raw = read("store/studio-workflow/" + name)
        rows.append({"relativePath": name, "sha256": digest(raw), "bytes": len(raw)})
    archived = [row for row in rows if row["relativePath"].startswith("chapters/") and row["relativePath"].split("/")[1] != "chapter-001"]
    assert read(manifest_relative) == manifest_raw, "manifest changed during audit"
    assert registry_file.read_bytes() == registry_raw, "registry changed during audit"
    # Aggregates bind ordered path + byte hash + size, without storing source text.
    aggregate = lambda items: digest(json.dumps(items, sort_keys=True, separators=(",", ":")).encode())
    return {"ok": True, "mode": "read-only", "realProjectWrites": 0, "deletes": 0,
            "projectId": PROJECT_ID, "projectRoot": str(PROJECT_ROOT), "chapterId": "chapter-001",
            "snapshotFile": str(snapshot_file.resolve()), "registryFile": str(registry_file.resolve()),
            "registrySha256": digest(registry_raw), "manifestSha256": digest(manifest_raw),
            "matchedSourceFiles": len(expected), "referencedShards": len(rows),
            "archivedChapters": len(manifest["chapterIndex"]) - 1,
            "archivedShardCount": len(archived), "archivedBytes": sum(row["bytes"] for row in archived),
            "archivedAggregateSha256": aggregate(archived), "allShardAggregateSha256": aggregate(rows),
            "aggregateFormat": "SHA256(compact sort_keys JSON ordered [{relativePath,sha256,bytes}])", "shards": rows}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    research = (TASK / "research").resolve()
    output = args.output.parent.resolve(strict=True) / args.output.name
    relative = output.relative_to(research)
    assert relative.parts[0].startswith("chapter001-apply-"), "output outside owned evidence"
    result = audit(args.snapshot.resolve(strict=True), args.registry.resolve(strict=True))
    with output.open("x") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps({key: value for key, value in result.items() if key != "shards"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
