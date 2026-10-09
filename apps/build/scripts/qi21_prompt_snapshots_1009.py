"""Refresh only the authorized qi21 t2i prompt snapshots; default is dry-run."""

import argparse
import copy
import hashlib
import json
import os
import re
import runpy
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

parser = argparse.ArgumentParser(description=__doc__)
mode = parser.add_mutually_exclusive_group()
mode.add_argument("--apply", action="store_true")
mode.add_argument("--check", action="store_true")
args = parser.parse_args()
assert __debug__, "Assertions must remain enabled"
repo = Path(__file__).resolve().parents[3]
task = repo / ".trellis/tasks/10-09-qi21-source-prompt-review-fixes"
source = repo / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
source_bytes = source.read_bytes()
source_sha = "79949894a349fc4689e9d4d2398d777c5526ddf7a1ed5903128772b78844b32b"
assert hashlib.sha256(source_bytes).hexdigest() == source_sha, "Source changed; stop"
data = json.loads(source_bytes)
formatter_path = repo / "apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_bases_text.py"
sync_path = repo / "apps/build/scripts/qi21_blueprint_sync_1001.py"
canon_path = source.parent.parent / "ma_sync/palette-canon.json"
guards = {path: path.read_bytes() for path in (source, formatter_path, sync_path, canon_path)}
assert guards[source] == source_bytes
assert len(json.loads(guards[canon_path])["colors"]) == 42
os.environ["MYSTUDIO_DAOJIE_DATA"] = str(source.parent)
formatter = runpy.run_path(str(formatter_path))
sync = runpy.run_path(str(sync_path))
assert formatter["_BASES_JSON"].resolve() == source
assert sync["REPO"].resolve() == repo
node_classes = {
    4030: formatter["MyQi21系统提示词"],
    4031: formatter["MyQi21色卡"],
    4032: formatter["MyQi21美术风格底座"],
}
style_fields = ("positive_style_text", "positive_ground_text", "rgba_text", "negative_text")
style_values = [data["art_style_base"][field].strip() for field in style_fields]
style_names = ("风格工艺件", "底色背景件", "透明承载件", "负向词表")
assert all(style_values) and all("\n" not in value for value in style_values)
protocol = "\n".join(f"【{name}】{value}" for name, value in zip(style_names, style_values))
assert node_classes[4032]().output()["result"][0] == protocol
expected = {
    4030: [node_classes[4030]().output()["result"][0]],
    4031: [node_classes[4031]().output()["result"][0]],
    4032: [*style_values, protocol],
}
assert expected[4030][0] == data["expand_instruction"]["system_prompt_zh"].strip()
assert "备选42色库读取失败" not in expected[4031][0]
targets = sync["TARGETS"]
documents = {}
graphs = {}
readonly_evidence = []
for tag, paths in targets.items():
    for role, path in paths.items():
        assert path.is_relative_to(repo) and not path.is_symlink()
        guards[path] = path.read_bytes()
        documents[path] = json.loads(guards[path])
        hits = [(index, graph) for index, graph in enumerate(documents[path]["definitions"]["subgraphs"])
                if graph["name"].startswith(sync["SG_NAME_PREFIX"])]
        assert len(hits) == 1
        graphs[path] = hits[0]
        if tag == "t2i":
            continue
        for node in hits[0][1]["nodes"]:
            slots = []
            if node["type"] == "MyQi21PromptAssembly":
                slots = [(1, "art_style_base.positive_text", data["art_style_base"]["positive_text"])]
            elif node["type"] == "MyQi21PromptSelect":
                slots = [(index, f"rgba.{key}", data["rgba"][key]) for index, key in
                         ((6, "head_en"), (7, "tail_en"), (8, "w1_closing"))]
            for index, source_field, value in slots:
                actual = node["widgets_values"][index]
                assert actual == value, (tag, role, node["id"], index, "Read-only snapshot drift")
                readonly_evidence.append({"file": str(path.relative_to(repo)), "node": node["id"],
                                          "slot": index, "source_field": source_field,
                                          "equal": True, "sha256": hashlib.sha256(actual.encode()).hexdigest()})
    normalized = [{key: value for key, value in graphs[path][1].items() if key != "id"}
                  for path in paths.values()]
    assert normalized[0] == normalized[1], f"{tag}: preexisting normalized definition drift"

plans = []
decoder = json.JSONDecoder()
original_sha = {
    "blueprint": "82fadf04b9d04d4a269f46da0bb0dcc0f4f1a143de23980d4a7520bf444f2383",
    "wf": "a8f3eb22993cc7e5f26fc53f6d57fda8b2c60d34b7e58d34e1ed0fcccd6c3c65",
}
for role, path in targets["t2i"].items():
    before = guards[path]
    text = before.decode("utf-8")
    graph_index, graph = graphs[path]
    desired = copy.deepcopy(documents[path])
    changes = []
    replacements = []
    allowed = set()
    for node_id, values in expected.items():
        matches = [(index, node) for index, node in enumerate(graph["nodes"]) if node["id"] == node_id]
        assert len(matches) == 1
        node_index, node = matches[0]
        assert node["type"] == "MyQi21" + {4030: "系统提示词", 4031: "色卡", 4032: "美术风格底座"}[node_id]
        assert len(node["widgets_values"]) == len(values)
        prefix = ("definitions", "subgraphs", graph_index, "nodes", node_index)
        desired_node = desired["definitions"]["subgraphs"][graph_index]["nodes"][node_index]
        anchors = list(re.finditer(r'(?m)^ {10}\{\n {12}"id": ' + str(node_id) + r',', text))
        assert len(anchors) == 1, (path, node_id, "Node anchor not unique")
        node_start = anchors[0].start() + 10
        decoded_node, node_end = decoder.raw_decode(text, node_start)
        assert decoded_node == node
        block = text[node_start:node_end]
        names = list(node_classes[node_id].INPUT_TYPES()["optional"])
        assert len(names) == len(values)
        containers = [("widgets_values", dict(enumerate(values)))]
        if "widgets_values_named" in node:
            assert set(node["widgets_values_named"]) <= set(names), "Unknown named widget keys"
            containers.append(("widgets_values_named", {name: values[names.index(name)]
                                                        for name in node["widgets_values_named"]}))
        for field, slot_values in containers:
            field_hits = list(re.finditer(r'"' + field + r'"\s*:\s*', block))
            assert len(field_hits) == 1
            container_start = node_start + field_hits[0].end()
            container, container_end = decoder.raw_decode(text, container_start)
            assert container == node[field]
            container_text = text[container_start:container_end]
            tokens = []
            if field == "widgets_values":
                tokens = list(re.finditer(r'"(?:[^"\\]|\\.)*"', container_text))
                assert len(tokens) == len(values)
            for slot, value in slot_values.items():
                old = container[slot]
                assert isinstance(old, str) and isinstance(value, str)
                if old == value:
                    continue
                if field == "widgets_values":
                    token = tokens[slot]
                    start, end = token.span()
                else:
                    key_hits = list(re.finditer(re.escape(json.dumps(slot, ensure_ascii=False)) + r'\s*:\s*', container_text))
                    assert len(key_hits) == 1
                    start = key_hits[0].end()
                    decoded, end = decoder.raw_decode(container_text, start)
                    assert decoded == old
                assert json.loads(container_text[start:end]) == old
                replacements.append((container_start + start, container_start + end,
                                     json.dumps(value, ensure_ascii=False)))
                desired_node[field][slot] = value
                changed_path = prefix + (field, slot)
                allowed.add(changed_path)
                changes.append({"node": node_id, "field": field, "slot": slot,
                                "line": text.count("\n", 0, container_start + start) + 1,
                                "path": list(changed_path), "old": old, "new": value})
    previous_start = len(text)
    patched = text
    for start, end, replacement in sorted(replacements, reverse=True):
        assert end <= previous_start
        patched = patched[:start] + replacement + patched[end:]
        previous_start = start
    after = patched.encode("utf-8")
    parsed = json.loads(after)
    assert parsed == desired
    actual_changes = set()
    pending: list[tuple[tuple[str | int, ...], Any, Any]] = [((), documents[path], parsed)]
    while pending:
        current_path, old, new = pending.pop()
        assert type(old) is type(new), current_path
        if isinstance(old, dict):
            assert old.keys() == new.keys(), current_path
            pending.extend((current_path + (key,), old[key], new[key]) for key in old)
        elif isinstance(old, list):
            assert len(old) == len(new), current_path
            pending.extend((current_path + (index,), old[index], new[index]) for index in range(len(old)))
        elif old != new:
            actual_changes.add(current_path)
    assert actual_changes == allowed
    if changes:
        assert hashlib.sha256(before).hexdigest() == original_sha[role], "Target changed since inspection"
    plans.append({"path": path, "before": before, "after": after, "changes": changes,
                  "parsed": parsed, "role": role})

normalized_after = [{key: value for key, value in plan["parsed"]["definitions"]["subgraphs"][graphs[plan["path"]][0]].items()
                     if key != "id"} for plan in plans]
assert normalized_after[0] == normalized_after[1]
for path, captured in guards.items():
    assert path.read_bytes() == captured, f"Concurrent change: {path}"
print(json.dumps({"source_sha256": source_sha, "normalized_definitions": "PASS: t2i/i2i/edit",
                  "readonly_comparisons": len(readonly_evidence),
                  "planned": [{"file": str(plan["path"].relative_to(repo)),
                               "changed_slots": len(plan["changes"])} for plan in plans]}, ensure_ascii=False))
if args.check:
    raise SystemExit(1 if any(plan["changes"] for plan in plans) else 0)
if not args.apply or not any(plan["changes"] for plan in plans):
    raise SystemExit(0)

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
backup_dir = task / "backups" / f"prompt-snapshots-{stamp}"
backup_dir.mkdir(parents=True, exist_ok=False)
for plan in plans:
    path = plan["path"]
    assert path.read_bytes() == plan["before"], f"Concurrent change before backup: {path}"
    backup = backup_dir / f'{plan["role"]}-before.json'
    shutil.copy2(path, backup)
    assert backup.read_bytes() == plan["before"]
    plan["backup"] = str(backup.relative_to(repo))
report = {
    "source_sha256": source_sha,
    "formatter": str(formatter_path.relative_to(repo)),
    "palette_sha256": hashlib.sha256(guards[canon_path]).hexdigest(),
    "normalized_definitions": {tag: True for tag in targets},
    "readonly_comparisons": readonly_evidence,
    "readonly_files": {str(path.relative_to(repo)): hashlib.sha256(guards[path]).hexdigest()
                       for tag in ("i2i", "edit") for path in targets[tag].values()},
    "files": [{"path": str(plan["path"].relative_to(repo)), "backup": plan["backup"],
               "sha256_before": hashlib.sha256(plan["before"]).hexdigest(),
               "sha256_after": hashlib.sha256(plan["after"]).hexdigest(),
               "changes": plan["changes"]} for plan in plans],
}
with (backup_dir / "field-report.json").open("x", encoding="utf-8") as handle:
    handle.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
for plan in plans:
    if not plan["changes"]:
        continue
    path = plan["path"]
    with tempfile.NamedTemporaryFile(dir=backup_dir, prefix=plan["role"] + "-stage-", delete=False) as handle:
        handle.write(plan["after"])
        handle.flush()
        os.fsync(handle.fileno())
        staged = Path(handle.name)
    staged.chmod(path.stat().st_mode & 0o777)
    for guarded_path, captured in guards.items():
        assert guarded_path.read_bytes() == captured, f"Concurrent change before write: {guarded_path}"
    assert path.read_bytes() == plan["before"], f"Concurrent target change: {path}"
    os.replace(staged, path)
    assert path.read_bytes() == plan["after"]
    assert json.loads(path.read_bytes()) == plan["parsed"]
    guards[path] = plan["after"]
for path, captured in guards.items():
    assert path.read_bytes() == captured, f"Concurrent change after write: {path}"
report["verified_after_write"] = True
report_path = task / "research" / f"prompt-snapshots-{stamp}.json"
with report_path.open("x", encoding="utf-8") as handle:
    handle.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(f"Applied and verified; report: {report_path.relative_to(repo)}")
