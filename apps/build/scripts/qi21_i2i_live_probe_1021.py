"""One explicitly authorized image probe; never deploys or reloads product code."""
from __future__ import annotations
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / ".trellis/tasks/10-20-trellis-audit-remediation/research/round13-i2i-live"
DATA = ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json"
HOME = next(p for p in (Path.home() / "Library/Application Support").iterdir()
            if p.name == "漫影工作室") / "comfyui"
PORT = json.loads((HOME / "manifest.json").read_text())["engine"]["port"]
URL = f"http://127.0.0.1:{PORT}"
sys.dont_write_bytecode = True
os.environ["MYSTUDIO_DAOJIE_DATA"] = str(DATA)
sys.path.insert(0, str(ROOT / "apps/backend"))


def request(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(URL + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def module(name):
    path = ROOT / "apps/backend/comfyui/my_nodes/nodes" / (name + ".py")
    spec = importlib.util.spec_from_file_location(name + "_probe13", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def prepare():
    subject = json.loads((ROOT / "apps/backend/comfyui/tests/fixtures/"
                          "qi21_multiview_subject_1021.json").read_text())["subject"]
    histories = json.loads((OUT / "recent-history.json").read_text())
    records = [(pid, r) for pid, r in histories.items()
               if r["prompt"][2].get("400", {}).get("inputs", {}).get("value") == subject]
    assert len(records) == 1
    old_id, record = records[0]
    old = record["prompt"][2]
    import comfyui.my_nodes.nodes.my_qi21_base as base_mod
    base, width, height, negative, transparent, type_name = base_mod.MyQi21DaojieBase().run("人物多视图")
    selector = module("my_qi21_prompt_select").MyQi21PromptSelect()
    assembly = module("my_qi21_prompt_assembly").MyQi21PromptAssembly()
    selected, _ = selector.compose(装配全文=subject, pe开关=False, 透明模式=False)
    assembled, negative = assembly.assemble(BASE=base, BASE负面=negative,
                                           主体句=selected, 组装用途="道劫美术类型")
    final, final_negative = selector.compose(装配全文=assembled, 负面词直写=negative,
                                             pe开关=False, 透明模式=transparent)
    assert subject in final and "single standalone asset" not in final
    assert "共四幅" in final
    for name, text in (("assembled.txt", assembled), ("final-prompt.txt", final),
                       ("final-negative.txt", final_negative)):
        (OUT / name).write_text(text + "\n")
    prompt = copy.deepcopy(old)
    # Freeze source-derived output in the live encoder: old assembly nodes are not executed.
    for key in ("171", "4015"):
        prompt[key]["inputs"]["prompt"] = final
        prompt[key]["inputs"]["negative_prompt"] = final_negative
    prompt["4"]["inputs"].update(width=width, height=height, batch_size=1)
    prompt["20"]["inputs"]["switch"] = True
    # Both real reference images reach both stages, using the existing main encoder.
    for key in ("7:7019", "7:7022"):
        prompt[key]["inputs"]["conditioning"] = ["4015", 0]
    prompt["5"]["inputs"]["samples"] = ["7:7024", 0]
    prompt["7:7014"]["inputs"]["value"] = 10210013
    prompt["8"]["inputs"]["filename_prefix"] = "qi21_round13_1021/multiview_viggle9"
    needed = set()
    def visit(key):
        if key in needed:
            return
        needed.add(key)
        for value in prompt[key]["inputs"].values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and value[0] in prompt:
                visit(value[0])
    visit("8")
    prompt = {k: v for k, v in prompt.items() if k in needed}
    assert not any(k.startswith("6:") for k in prompt)
    assert prompt["4015"]["inputs"]["images.image_2"] == ["17", 0]
    assert prompt["20"]["inputs"]["on_true"] == ["4", 0]
    refs = []
    for key in ("10", "11"):
        path = HOME / "input" / prompt[key]["inputs"]["image"]
        assert path.is_file()
        refs.append({"node": key, "path": str(path.resolve()),
                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    payload = {"prompt": prompt, "client_id": "round13-i2i-once-1021"}
    save("payload.json", payload)
    save("prepare.json", {
        "sourceHistoryPromptId": old_id, "mode": "source-export-injected-into-live-encoder",
        "liveAssemblyVerified": False, "canvas": [width, height], "type": type_name,
        "rgba": transparent, "references": refs, "nodes": len(prompt),
        "sampler": "viggle 9 steps (7+2)", "styleLora": prompt["7:7034"]["inputs"],
        "seed": 10210013, "subjectVerbatimPreserved": True,
        "finalPromptSha256": hashlib.sha256(final.encode()).hexdigest(),
        "sourceLibrarySha256": hashlib.sha256((DATA / "qi21_bases.json").read_bytes()).hexdigest(),
        "testOnlyOverrides": ["offline source final text into encoder; no runtime assembly",
                              "type canvas rather than old reference canvas",
                              "two-reference conditioning for both viggle stages",
                              "viggle9 7+2 branch; no Turbo or direct sampling", "fixed probe seed/output prefix"],
        "knownSemanticConflict": "strict reference identity/clothing lock vs text hairpin/wear/shoes/bag",
        "generationAuthorization": "user asked one image test; one POST only; general holds retained",
    })
    print(json.dumps(json.loads((OUT / "prepare.json").read_text()), ensure_ascii=False))


def submit():
    assert not (OUT / "submission.json").exists(), "already submitted; no duplicate image permitted"
    queue = request("/queue")
    save("queue-before-submit.json", queue)
    assert not queue["queue_running"] and not queue["queue_pending"], "shared engine busy"
    # Store attempt before POST: a transport error must not silently cause a second image.
    assert not (OUT / "submission-attempt.json").exists(), "previous POST attempt requires reconciliation"
    save("submission-attempt.json", {"singleAttempt": True, "endpoint": URL + "/prompt"})
    payload = json.loads((OUT / "payload.json").read_text())
    result = request("/prompt", payload)
    save("submission.json", result)
    assert result.get("prompt_id") and not result.get("node_errors")
    print(json.dumps(result, ensure_ascii=False))


def poll():
    pid = json.loads((OUT / "submission.json").read_text())["prompt_id"]
    history = request("/history/" + pid)
    if pid not in history:
        print(json.dumps({"prompt_id": pid, "complete": False, "queue": request("/queue")}, ensure_ascii=False)[:1500])
        return
    save("history.json", history)
    rec = history[pid]
    success = rec["status"]["status_str"] == "success"
    result = {"prompt_id": pid, "complete": True, "success": success, "outputs": rec.get("outputs", {})}
    if success:
        images = rec["outputs"]["8"]["images"]
        assert len(images) == 1
        entry = images[0]
        source = HOME / entry["type"] / entry["subfolder"] / entry["filename"]
        assert source.is_file()
        from PIL import Image
        with Image.open(source) as im:
            im.load()
            result.update(image=str(source.resolve()), size=list(im.size), mode=im.mode)
            if im.mode == "RGBA":
                alpha = im.getchannel("A")
                histogram = alpha.histogram()
                result["alphaRange"] = alpha.getextrema()
                result["alphaZeroFraction"] = histogram[0] / (im.width * im.height)
                result["alphaNonOpaqueFraction"] = sum(histogram[:255]) / (im.width * im.height)
        # Save a durable review copy with byte identity; source output is untouched.
        target = OUT / "result.png"
        assert not target.exists()
        target.write_bytes(source.read_bytes())
        result.update(reviewCopy=str(target), sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    save("result.json", result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "submit", "poll"])
    args = parser.parse_args()
    {"prepare": prepare, "submit": submit, "poll": poll}[args.action]()
