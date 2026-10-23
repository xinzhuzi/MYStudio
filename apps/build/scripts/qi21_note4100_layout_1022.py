"""Halve note 4100 and center it above the prompt subgraph; layout only."""
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
targets = [
    (REPO / "apps/backend/comfyui/workflows", "^qi21-道劫-t2i.json$"),
    (REPO / "apps/backend/comfyui/my_nodes/subgraphs", "^qi21-提示词类型优化子图.json$"),
]
if sys.argv[1:]:
    app_home = next(p for p in (Path.home() / "Library/Application Support").iterdir()
                    if p.name == "漫影工作室")
    targets = [(app_home / "comfyui/ComfyUI/user/default/workflows", targets[0][1])]

pending = []
evidence = []
definitions = []
for directory, pattern in targets:
    paths = subprocess.check_output(
        ["fd", "-a", pattern, str(directory), "--hidden", "--no-ignore"], text=True,
    ).splitlines()
    assert len(paths) == 1, paths
    path = Path(paths[0])
    raw = path.read_bytes()
    original = json.loads(raw)
    graphs = [s for s in original["definitions"]["subgraphs"]
              if any(n["id"] == 4100 for n in s["nodes"])]
    assert len(graphs) == 1
    graph = graphs[0]
    note = next(n for n in graph["nodes"] if n["id"] == 4100)
    assert note["title"] == "[4100] 提示词子图说明卡"
    assert note["type"] == "MarkdownNote"
    peers = [n for n in graph["nodes"] if n["id"] != 4100]
    left = min(n["pos"][0] for n in peers)
    right = max(n["pos"][0] + lc.est_size(n)[0] for n in peers)
    new_x = (left + right - 1330) / 2
    assert new_x == 740.1302083333339, (left, right)
    assert note["pos"] in ([80, 80], [new_x, 80])
    assert note["size"] in ([2660, 440], [1330, 440])
    updated = copy.deepcopy(original)
    updated_graph = next(s for s in updated["definitions"]["subgraphs"]
                         if s["id"] == graph["id"])
    updated_note = next(n for n in updated_graph["nodes"] if n["id"] == 4100)
    updated_note["pos"] = [new_x, 80]
    updated_note["size"] = [1330, 440]
    definitions.append({k: v for k, v in updated_graph.items() if k != "id"})
    if updated == original:
        print(f"Already centered at half width: {path}")
        continue
    assert note["pos"] == [80, 80] and note["size"] == [2660, 440]
    before = lc.check_workflow(original)
    after = lc.check_workflow(updated)
    assert [r["name"] for r in before] == [r["name"] for r in after]
    for old, new in zip(before, after):
        for key in lc.CHECK_KEYS:
            assert new["counts"][key] <= old["counts"][key], (new["name"], key)
    report = next(r for r in after if r["name"] == "sub:" + graph["name"])
    assert report["counts"]["est_overlap"] == 0
    assert not any(4100 in v.get("nodes", []) for v in report["violations"])
    lines = raw.splitlines(keepends=True)
    indices = [i for i, line in enumerate(lines) if line.strip() == b'"id": 4100,']
    assert len(indices) == 1
    i = indices[0]
    assert [line.strip() for line in lines[i:i + 10]] == [
        b'"id": 4100,', b'"type": "MarkdownNote",', b'"pos": [',
        b'80,', b'80', b'],', b'"size": [', b'2660,', b'440', b'],',
    ]
    lines[i + 3] = lines[i + 3].replace(b"80,", f"{new_x},".encode(), 1)
    lines[i + 7] = lines[i + 7].replace(b"2660,", b"1330,", 1)
    result = b"".join(lines)
    assert json.loads(result) == updated, "Unexpected non-layout change."
    pending.append((path, raw, result))
    evidence.append({"path": str(path), "before": {"pos": note["pos"], "size": note["size"]},
                     "after": {"pos": updated_note["pos"], "size": updated_note["size"]},
                     "before_sha256": hashlib.sha256(raw).hexdigest(),
                     "after_sha256": hashlib.sha256(result).hexdigest(),
                     "before_layout": before, "after_layout": after})

assert all(s == definitions[0] for s in definitions), "Blueprint/host drift."
assert all(path.read_bytes() == raw for path, raw, _ in pending), "Concurrent edit detected."
for path, _, result in pending:
    path.write_bytes(result)
    assert path.read_bytes() == result
    print(f"Note 4100: width 2660 -> 1330; centered x=740.1302083333339, y=80: {path}")
if evidence:
    name = "qi21-note4100-layout-cache-1022.json" if sys.argv[1:] else "qi21-note4100-layout-1022.json"
    (REPO / "apps/output/automation" / name).write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
    )
