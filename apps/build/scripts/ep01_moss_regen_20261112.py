#!/usr/bin/env python3
"""EP01 图像资产役(1112):MOSS 道劫直投定点重出 chapter-001 镜 3/11。

载荷规则(依役单 2026-11-12):
- 模板: apps/backend/comfyui/workflows/1_图片/MossImage/moss-道劫-t2i-api.json(递归剥 _doc 键)
- 节点5 正向 = 底座全文(qi21_bases.json art_style_base.positive_text) + 剑尘人物正典 + 镜画面
- 节点6 负向 = 同文件 negative_text 全量
- 节点7 尺寸 = 1920x1088;节点8 seed = 1108+镜号;节点11 前缀 = ep01-regen/sb-XXX
- 提交 http://127.0.0.1:17002/prompt(MOSS 评测引擎,SSH 隧道),轮询 /history 至出图
镜画面真源: MA store chapter-001 分镜记录(rev3/state=ready)。
"""
import json
import time
import urllib.request
import urllib.error

REPO = "/Users/zhengbingjin/Project/Github/MYStudio"
TEMPLATE = f"{REPO}/apps/backend/comfyui/workflows/1_图片/MossImage/moss-道劫-t2i-api.json"
BASES = f"{REPO}/apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
STORE_003 = "/Users/zhengbingjin/Project/IP/MA/store/studio-workflow/chapters/chapter-001/storyboards-001-5d9afb5d.json"
STORE_011 = "/Users/zhengbingjin/Project/IP/MA/store/studio-workflow/chapters/chapter-001/storyboards-002-cc679b4c.json"
API = "http://127.0.0.1:17002"
SEED_BASE = 1108
SHOTS = {3: STORE_003, 11: STORE_011}

# 剑尘人物正典(役单原文要点,2026-11-12)
CANON = ("人物正典：独孤剑尘，约40岁，清瘦冷峻的剑修；黑发，两鬓染霜（非全白银发）；"
         "灰袍，右肩有一道裂痕；腰悬归元古剑。")


def strip_doc(obj):
    if isinstance(obj, dict):
        return {k: strip_doc(v) for k, v in obj.items() if not k.startswith("_")}
    if isinstance(obj, list):
        return [strip_doc(v) for v in obj]
    return obj


def shot_prompt(store_path, shot_id):
    d = json.load(open(store_path, encoding="utf-8"))
    sid = f"sb-chapter-001-{shot_id:03d}"
    for rec in d["state"]["storyboards"]:
        if rec.get("id") == sid:
            assert rec.get("state") == "ready", f"{sid} state={rec.get('state')}"
            return rec["prompt"]
    raise KeyError(sid)


def build(shot, text_pos, text_neg):
    wf = strip_doc(json.load(open(TEMPLATE, encoding="utf-8")))
    wf["5"]["inputs"]["text"] = text_pos
    wf["6"]["inputs"]["text"] = text_neg
    wf["7"]["inputs"]["width"] = 1920
    wf["7"]["inputs"]["height"] = 1088
    wf["8"]["inputs"]["seed"] = SEED_BASE + shot
    wf["11"]["inputs"]["filename_prefix"] = f"ep01-regen/sb-{shot:03d}"
    return wf


def post(wf):
    body = json.dumps({"prompt": wf, "client_id": "ep01-asset-1112"}).encode()
    req = urllib.request.Request(f"{API}/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["prompt_id"]


def wait(pid, timeout_s=2100):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            with urllib.request.urlopen(f"{API}/history/{pid}", timeout=20) as r:
                h = json.load(r)
        except Exception:
            time.sleep(10)
            continue
        if pid in h:
            rec = h[pid]
            imgs = rec.get("outputs", {}).get("11", {}).get("images", [])
            if imgs:
                return {"status": "done", "images": imgs}
            if rec.get("status", {}).get("status_str") == "error":
                return {"status": "error", "status": rec["status"]}
        time.sleep(15)
    return {"status": "timeout"}


def main():
    bases = json.load(open(BASES, encoding="utf-8"))["art_style_base"]
    pos_base, neg = bases["positive_text"], bases["negative_text"]
    results = {}
    ids = {}
    for shot, store in SHOTS.items():
        sp = shot_prompt(store, shot)
        text_pos = f"{pos_base}\n{CANON}\n镜画面：{sp}"
        wf = build(shot, text_pos, neg)
        pid = post(wf)
        ids[shot] = pid
        print(f"[submit] shot={shot:03d} seed={SEED_BASE + shot} pid={pid} "
              f"pos_len={len(text_pos)} neg_len={len(neg)}", flush=True)
    json.dump(ids, open("/tmp/ep01_regen_ids.json", "w"))
    for shot, pid in ids.items():
        res = wait(pid)
        results[shot] = res
        print(f"[result] shot={shot:03d} pid={pid} -> {json.dumps(res, ensure_ascii=False)}", flush=True)
    ok = all(r["status"] == "done" for r in results.values())
    print("ALL-DONE" if ok else "INCOMPLETE", flush=True)


if __name__ == "__main__":
    main()
