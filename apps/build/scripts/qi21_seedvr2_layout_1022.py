"""Move only the t2i SeedVR2 host left, with layout and concurrent-write guards."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".agents/skills/node-graph/tools"))
import layout_check as lc  # noqa: E402

assert sys.argv[1:] in ([], ["--user-cache"])
target_dir = REPO / "apps/backend/engines/comfyui/workflows"
if sys.argv[1:]:
    app_home = next(p for p in (Path.home() / "Library/Application Support").iterdir()
                    if p.name == "漫影工作室")
    target_dir = app_home / "comfyui/ComfyUI/user/default/workflows"
paths = subprocess.check_output(
    ["fd", "-a", "^qi21-道劫-t2i.json$", str(target_dir), "--hidden", "--no-ignore"],
    text=True,
).splitlines()
assert len(paths) == 1, paths
path = Path(paths[0])
raw = path.read_bytes()
original = json.loads(raw)
nodes = [n for n in original["nodes"] if n["id"] == 503]
assert len(nodes) == 1
node = nodes[0]
assert node["title"] == "超分·D SeedVR2"
assert node["type"] == "f0a844a8-9bf5-4c71-8af5-f1c9f17c0324"
assert node["size"] == [360, 458]
assert node["pos"] in ([8520, 2280], [8000, 2280]), node["pos"]
if node["pos"] == [8000, 2280]:
    print("Already positioned: node 503 [8000, 2280]; no write.")
    sys.exit(0)

updated = copy.deepcopy(original)
next(n for n in updated["nodes"] if n["id"] == 503)["pos"][0] = 8000
before = lc.check_workflow(original)
after = lc.check_workflow(updated)
assert [r["name"] for r in before] == [r["name"] for r in after]
for old, new in zip(before, after):
    for key in lc.CHECK_KEYS:
        assert new["counts"][key] <= old["counts"][key], (new["name"], key)
assert after[0]["counts"]["est_overlap"] == 0
assert after[0]["counts"]["est_spacing"] == 0
assert not any(503 in v.get("nodes", []) for v in after[0]["violations"])

old_text = b'"id": 503,\n      "type": "f0a844a8-9bf5-4c71-8af5-f1c9f17c0324",\n      "pos": [\n        8520,'
new_text = old_text.replace(b"8520", b"8000")
assert raw.count(old_text) == 1
result = raw.replace(old_text, new_text, 1)
assert json.loads(result) == updated
assert path.read_bytes() == raw, "Concurrent edit detected; refusing to overwrite."
path.write_bytes(result)
assert path.read_bytes() == result

evidence = {
    "path": str(path), "node": 503, "before_pos": [8520, 2280],
    "after_pos": [8000, 2280], "only_change": "nodes[id=503].pos[0]",
    "before_sha256": hashlib.sha256(raw).hexdigest(),
    "after_sha256": hashlib.sha256(result).hexdigest(),
    "before": before, "after": after,
}
output_name = "qi21-seedvr2-layout-cache-1022.json" if sys.argv[1:] else "qi21-seedvr2-layout-1022.json"
output = REPO / "apps/output/automation" / output_name
output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
print("Moved node 503: [8520, 2280] -> [8000, 2280]; only x changed.")
print("Main graph overlaps: 0; spacing violations: 2 -> 0; all other counts unchanged.")
print(output)
