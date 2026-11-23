#!/usr/bin/env python3
"""Gem② Turbo8 换装·十四型全型扫测 · 1118(剩余 12 型,t2i 件内直发)。

每型一发:6:4010 base=型 → 型画幅/型句走产线正路(t2i 无参考图=零参考匹配坑)
→ 裸图[8] + Gem超分[504] 双产物落 apps/output/gem-t8-1118/types/<型>/。
队列空闲才发(同秒双进程刻碑);单型失败记录后续跑(容错收集)。
"""
from __future__ import annotations
import json, random, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TWIN = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json"
OUT = REPO / "apps/output/gem-t8-1118/types"
ENGINE = "http://192.168.0.101:17000"
TYPES = ["道具", "美宣", "人物多视图", "高清人脸", "分镜剧情图", "表情差分",
         "概念气氛图", "设定卡", "3D剖面场景图", "人脸基准", "无衣物定妆", "自由"]
NEW_LORA = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"

for k in list(__import__("os").environ):
    if "proxy" in k.lower():
        del __import__("os").environ[k]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get(p, t=20):
    with opener.open(ENGINE + p, timeout=t) as r:
        return json.load(r)


def wait_idle(timeout=900):
    t0 = time.time()
    while time.time() - t0 < timeout:
        q = get("/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            return True
        time.sleep(5)
    return False


def fire(t: str) -> dict:
    graph = json.loads(TWIN.read_text(encoding="utf-8"))["graph"]
    seed = random.randint(1, 2**31 - 1)
    graph["6:4010"]["inputs"]["base"] = t
    graph["7:7014"]["inputs"]["value"] = seed
    assert graph["8112"]["inputs"]["lora_name"] == NEW_LORA
    assert graph["8118"]["inputs"]["steps"] == 8
    if not wait_idle():
        print(f"[sweep] {t}: 队列900s未清空,入队排队(引擎串行正典)", flush=True)
    req = urllib.request.Request(ENGINE + "/prompt",
                                 data=json.dumps({"prompt": graph, "client_id": "gem-t8-sweep"}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(opener.open(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        return {"type": t, "ok": False, "err": "拒单:" + e.read().decode()[:300]}
    t0 = time.time()
    while time.time() - t0 < 1500:
        time.sleep(10)
        try:
            h = get(f"/history/{pid}", 15)
        except Exception:
            continue
        rec = h.get(pid)
        if not rec:
            continue
        st = rec.get("status", {})
        if st.get("status_str") == "error":
            return {"type": t, "ok": False, "err": str(st.get("messages"))[:400], "pid": pid}
        outs = rec.get("outputs", {})
        if any("images" in o for o in outs.values()):
            d = OUT / t
            d.mkdir(parents=True, exist_ok=True)
            files = []
            for nid in sorted(outs):
                for img in outs[nid].get("images", []):
                    url = (f"{ENGINE}/view?filename={urllib.parse.quote(img['filename'])}"
                           f"&type={img.get('type', 'output')}&subfolder={urllib.parse.quote(img.get('subfolder', ''))}")
                    data = opener.open(url, timeout=120).read()
                    p = d / f"node{nid}_{img['filename']}"
                    p.write_bytes(data)
                    import struct
                    w, hh = struct.unpack(">II", data[16:24])
                    files.append({"node": nid, "w": w, "h": hh, "bytes": len(data), "path": str(p.relative_to(REPO))})
            return {"type": t, "ok": True, "seed": seed, "pid": pid, "sec": round(time.time() - t0), "files": files}
    return {"type": t, "ok": False, "err": "1500s超时", "pid": pid}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    for t in TYPES:
        r = fire(t)
        results.append(r)
        print(f"[sweep] {t}: {'OK' if r['ok'] else 'FAIL ' + str(r.get('err'))[:120]}"
              + (f" files={[(f['node'], f['w'], f['h']) for f in r.get('files', [])]}" if r["ok"] else ""), flush=True)
        (OUT / "_results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = sum(1 for r in results if r["ok"])
    print(f"[sweep] 终账 {ok}/{len(results)}")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
