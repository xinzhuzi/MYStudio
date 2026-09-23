#!/usr/bin/env python3
"""道劫底座·留白去载体 A/B 实弹(09-22):验「大面积留白承担画面」纯画法写法不弱于载体枚举写法。

背景:场景/气氛底座旧句「大面积天空、水面或雾(气)承担空白/留白」把内容词(载体)
写进画法底座,主体句场景没有这些元素时模型会硬塞雾气或弃掉留白(09-22 用户质询)。
已改「大面积留白承担画面」+载体点名权移交主体句(purpose 注明按场景择一)。本脚本
实弹验证改法成立。

单变量设计(五臂,seed=42,1280x720,场景型,步数/cfg 用工作流现值):
  B_new_snow  新底座 × 雪原句(天然带载体,主体句不点名) —— 验证自然场景不掉留白
  D_new_cave  新底座 × 洞窟句(无任何载体,主体句不点名) —— 验证无载体场景不弃留白
  E_new_cave_named 新底座 × 洞窟句+点名「烟霭承担画面的大面积留白」—— 新设计完整用法
  A_old_snow  旧底座 × 雪原句 —— 载体枚举原设计基线
  C_old_cave  旧底座 × 洞窟句 —— 旧设计失效case(预期硬塞雾/天空或背景变密)
旧臂注入法:引擎家 daojie_bases.json 场景 positive 仅回退载体句(「大面积留白承担
画面」→「大面积天空、水面或雾承担空白」),其余今日改动(线有粗细变化/远处用淡墨)
两臂一致,确保唯一变量=载体句;节点 mtime 感知现读,换文件即生效。跑完 finally 恒
以仓库真源 rsync 回引擎家并 SHA 对账。

[62] 回读锚:旧臂须含「承担空白」,新臂须含「大面积留白承担画面」且不含「承担空白」。
成图经 /view 下载 → ~/Downloads/daojie_blank_carrier_ab_0922/<臂名>.png。

用法:python3 apps/build/scripts/campaigns/daojie_blank_carrier_ab_0922.py [--base-url http://127.0.0.1:17000]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import time
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]  # campaigns/ 比旧脚本深一层
sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
REPO_BASES = (REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json")
ENGINE_BASES = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
                / "ComfyUI/custom_nodes/my-nodes/nodes/daojie_bases.json")
DOWNLOADS = Path.home() / "Downloads" / "daojie_blank_carrier_ab_0922"
CLIENT_ID = "daojie-blank-carrier-ab-0922"
SEED = 42
WIDTH, HEIGHT = 1280, 720
EXEC_TIMEOUT_S = 420
IDLE_WAIT_MAX_S = 600
POLL_S = 4

NEW_BLANK = "大面积留白承担画面"
OLD_BLANK = "大面积天空、水面或雾承担空白"

SNOW = ("隆冬正午，极北雪原上的一座孤峰剑冢，数十柄断剑斜插在雪中，"
        "冢前一块半埋的石碑。")
CAVE = ("地底洞窟深处的丹炉石室，炉火将熄，石壁凿痕层层退入黑暗，"
        "一缕青烟从炉口升起。")
CAVE_NAMED = CAVE + "烟霭承担画面的大面积留白。"

AUTHOR_PLW = "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0"

# (臂名, 底座版, 主体句, 主体句回读锚)
RUNS = [
    ("B_new_snow", "new", SNOW, "隆冬正午"),
    ("D_new_cave", "new", CAVE, "地底洞窟深处"),
    ("E_new_cave_named", "new", CAVE_NAMED, "地底洞窟深处"),
    ("A_old_snow", "old", SNOW, "隆冬正午"),
    ("C_old_cave", "old", CAVE, "地底洞窟深处"),
]
COMMON_OVERRIDES = {
    "12.seed": SEED,
    "53.width": WIDTH,
    "53.height": HEIGHT,
    "80.base": "场景",
    "63.per_layer_weights": AUTHOR_PLW,
}


def wait_idle(base: str) -> bool:
    t0 = time.time()
    while time.time() - t0 < IDLE_WAIT_MAX_S:
        q = http_json(f"{base}/queue", timeout=10)
        if not q.get("queue_running") and not q.get("queue_pending"):
            return True
        time.sleep(5)
    return False


def wait_done(base: str, pid: str) -> dict | None:
    t0 = time.time()
    while time.time() - t0 < EXEC_TIMEOUT_S:
        hist = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in hist:
            return hist[pid]
        time.sleep(POLL_S)
    return None


def first_image(entry: dict) -> dict | None:
    for _nid, out in (entry.get("outputs") or {}).items():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                for x in imgs:
                    if isinstance(x, dict) and "filename" in x:
                        return x
    return None


def final_positive(entry: dict) -> str | None:
    out62 = (entry.get("outputs") or {}).get("62") or {}
    texts = out62.get("text") or []
    if isinstance(texts, list) and texts and isinstance(texts[0], str):
        return texts[0]
    return None


def swap_engine_blank(ver: str) -> None:
    """引擎家场景 positive 的载体句新旧切换;ver=restore 时整文件回真源。"""
    if ver == "restore":
        shutil.copyfile(REPO_BASES, ENGINE_BASES)
    else:
        data = json.loads(ENGINE_BASES.read_text(encoding="utf-8"))
        for it in data:
            if it["zh"] == "场景":
                if ver == "new":
                    assert OLD_BLANK not in it["positive"], "引擎家已是新句,旧臂回退无意义"
                    it["positive"] = it["positive"].replace(OLD_BLANK, NEW_BLANK)
                else:
                    assert NEW_BLANK in it["positive"], f"引擎家无新句,当前态异常:{it['positive'][:40]}"
                    it["positive"] = it["positive"].replace(NEW_BLANK, OLD_BLANK)
                break
        else:
            raise RuntimeError("引擎家 daojie_bases.json 找不到场景条目")
        ENGINE_BASES.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    got = hashlib.sha256(ENGINE_BASES.read_bytes()).hexdigest()
    if ver == "restore":
        want = hashlib.sha256(REPO_BASES.read_bytes()).hexdigest()
        assert got == want, f"restore 后 SHA 不一致 {got} != {want}"
    print(f"[swap] ver={ver} sha={got[:12]}", flush=True)


def run_arm(base: str, name: str, ver: str, subject: str, subj_head: str,
            wf: dict, oi: dict) -> dict:
    overrides = dict(COMMON_OVERRIDES)
    overrides["50.value"] = subject
    graph = ui_to_api(wf, oi, overrides)
    graph["80"]["inputs"].pop("negative", None)  # forceInput 未连线槽,同 0919 惯例弹出

    if not wait_idle(base):
        return {"name": name, "ran": False, "skip_reason": f"引擎忙(>{IDLE_WAIT_MAX_S}s)"}
    resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
    if resp.get("node_errors"):
        return {"name": name, "ran": False, "skip_reason": "node_errors",
                "detail": json.dumps(resp["node_errors"], ensure_ascii=False)[:800]}
    pid = resp["prompt_id"]
    t0 = time.time()
    entry = wait_done(base, pid)
    wall = round(time.time() - t0, 1)
    if entry is None:
        return {"name": name, "ran": False, "skip_reason": f"超时(>{EXEC_TIMEOUT_S}s)",
                "prompt_id": pid}
    if entry.get("status", {}).get("status_str") != "success":
        errs = [m for m in entry["status"].get("messages", []) if m[0] == "execution_error"]
        return {"name": name, "ran": False, "skip_reason": "execution_failed",
                "detail": errs[:1], "prompt_id": pid}

    final = final_positive(entry) or ""
    want = NEW_BLANK if ver == "new" else OLD_BLANK
    other = OLD_BLANK if ver == "new" else NEW_BLANK
    ok_blank, ok_other, ok_subj = want in final, other not in final, subj_head in final
    if not (ok_blank and ok_other and ok_subj):
        return {"name": name, "ran": False, "skip_reason": "final_positive 校验失败",
                "blank_ok": ok_blank, "other_absent_ok": ok_other, "subj_ok": ok_subj,
                "final_head_100": final[:100], "prompt_id": pid}

    image = first_image(entry)
    if image is None:
        return {"name": name, "ran": False, "skip_reason": "history 无图片输出",
                "prompt_id": pid}
    q = (f"filename={urllib.parse.quote(image['filename'])}"
         f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}&type=output")
    png = http_bytes(f"{base}/view?{q}")
    out = DOWNLOADS / f"{name}.png"
    out.write_bytes(png)
    print(f"[ab] {name} 完成 wall={wall}s bytes={len(png)} -> {out.name}", flush=True)
    return {"name": name, "ran": True, "prompt_id": pid, "wall_s": wall,
            "bytes": len(png), "output": str(out),
            "steps": graph["12"]["inputs"]["steps"], "cfg": graph["12"]["inputs"]["cfg"],
            "base_ver": ver}


def scene_blank_state() -> tuple[bool, bool]:
    """只看场景条目(气氛条目恒含新句,全文件扫会误判双态)。"""
    for it in json.loads(ENGINE_BASES.read_text(encoding="utf-8")):
        if it["zh"] == "场景":
            return NEW_BLANK in it["positive"], OLD_BLANK in it["positive"]
    raise RuntimeError("引擎家 daojie_bases.json 找不到场景条目")


def main() -> int:
    ap = argparse.ArgumentParser(description="道劫底座留白去载体五臂 A/B")
    ap.add_argument("--base-url", default="http://127.0.0.1:17000")
    ap.add_argument("--only", default="", help="只跑指定臂(逗号分隔),如 C_old_cave")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    only = {x.strip() for x in args.only.split(",") if x.strip()}

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)

    results = []
    try:
        for name, ver, subject, subj_head in RUNS:
            if only and name not in only:
                continue
            # 逐臂确保引擎家场景载体句处于该臂版本(mtime 现读,幂等切换)
            has_new, has_old = scene_blank_state()
            if ver == "new" and has_old and not has_new:
                swap_engine_blank("new")
            elif ver == "old" and has_new and not has_old:
                swap_engine_blank("old")
            elif (ver == "new") != has_new:
                print(json.dumps({"fatal": f"臂 {name} 前置态异常 has_new={has_new} "
                                           f"has_old={has_old}"}), flush=True)
                return 1
            results.append(run_arm(base, name, ver, subject, subj_head, wf, oi))
    finally:
        swap_engine_blank("restore")

    audit_path = DOWNLOADS / "runs_audit.json"
    if audit_path.is_file() and only:  # --only 补跑时按臂名合并,不冲掉已有记录
        prior = {r["name"]: r for r in
                 json.loads(audit_path.read_text(encoding="utf-8")).get("runs", [])}
        results = [prior.get(r["name"], r) if r["name"] not in prior else r
                   for r in results] + [v for k, v in prior.items()
                                        if k not in {r["name"] for r in results}]
    report = {"status": "done", "runs": results,
              "ok_count": sum(1 for r in results if r.get("ran")),
              "common": {"seed": SEED, "width": WIDTH, "height": HEIGHT,
                         "base_type": "场景", "author_plw": AUTHOR_PLW,
                         "var_note": "唯一变量=载体句(旧枚举 vs 新纯画法);主体句各臂内一致"},
              "engine_bases_restored_sha12": hashlib.sha256(
                  ENGINE_BASES.read_bytes()).hexdigest()[:12]}
    (DOWNLOADS / "runs_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1), flush=True)
    return 0 if all(r.get("ran") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
