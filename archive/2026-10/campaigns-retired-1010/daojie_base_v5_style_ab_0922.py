#!/usr/bin/env python3
"""道劫底座 v5 纯画法 A/B 实弹(09-22):验「零物象词纯画法底座」画风不掉。

背景:v5(用户裁定:底座不带有具体画面)撤出全部物象词(部位/景物/器物/叙事),
物象指代一律「主体」,各型只留最小构图句+五要素画法。风险=画法失去落点
(细墨线勾的是眉眼还是衣褶无从谈起),风格绑定可能变弱。本脚本同 seed 对拍
v4.1(物象版,今日上午终态)vs v5(纯画法版),人物/场景各一对,共四臂。

设计(seed=42,步数/cfg 工作流现值,[63] 作者档强制,真 [80] 节点):
  G_new_renwu 864×1152  base=人物 新主体句(部件点名归主体句,v5 设计用法)
  Gc_old_renwu 同上      底座换 v4.1 人物(物象版) —— 唯一变量=底座文字
  H_new_scene 1280×720  base=场景 雪原句
  Hc_old_scene 同上      底座换 v4.1 场景(物象版)
旧臂注入=引擎家 daojie_bases.json 对应型 positive 整段换 v4.1 文本(节点
mtime 现读);finally 恒以仓库真源恢复并 SHA 对账。[62] 回读锚按臂校验。

用法:python3 apps/build/scripts/campaigns/daojie_base_v5_style_ab_0922.py [--only 臂名]
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

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
REPO_BASES = (REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json")
ENGINE_BASES = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
                / "ComfyUI/custom_nodes/my-nodes/nodes/daojie_bases.json")
DOWNLOADS = Path.home() / "Downloads" / "daojie_base_v5_style_ab_0922"
CLIENT_ID = "daojie-base-v5-ab-0922"
SEED = 42
EXEC_TIMEOUT_S = 420
IDLE_WAIT_MAX_S = 600
POLL_S = 4

# v4.1(物象版)终态,今日 v5 改写前逐字留档 —— 唯一变量的"旧"侧
OLD_POS = {
    "人物": ("一位角色的单人立绘，细墨线勾出骨相、眉眼、发丝与衣褶，线有粗细变化，"
             "衣褶疏朗，长褶只落在关节处。淡墨晕开远处的空气，近处轮廓清楚。"
             "大面积素净底色，中等强度的衣色，一小块鲜明的点题色。均匀柔光，"
             "平涂的底，全身入画，四周留出空地。"),
    "场景": ("一处空无一人的山水场景，前、中、远三层分开。近处枝干与檐角用细墨线勾出，"
             "线有粗细变化，中景建筑与道路用色块晕开成形，远处用淡墨一层层退去。"
             "大面积留白承担画面，底色素净，只留一小块鲜明的点题色。均匀柔光，"
             "平涂的底，颜色清透。"),
}
NEW_ANCHOR = {"人物": "主体的单人立绘", "场景": "空无一人的空镜场景"}
OLD_ANCHOR = {"人物": "一位角色的单人立绘", "场景": "一处空无一人的山水场景"}

RENWU_SUBJ = ("一位青衫剑修，身形挺拔，乌发束冠，负手而立，"
              "目光沉静地望向远方。")
SCENE_SUBJ = ("隆冬正午，极北雪原上的一座孤峰剑冢，数十柄断剑斜插在雪中，"
              "冢前一块半埋的石碑。")

AUTHOR_PLW = "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0"

# (臂名, 型, 底座版, 主体句, 回读锚, 宽, 高)
RUNS = [
    ("G_new_renwu", "人物", "new", RENWU_SUBJ, "一位青衫剑修", 864, 1152),
    ("H_new_scene", "场景", "new", SCENE_SUBJ, "隆冬正午", 1280, 720),
    ("Gc_old_renwu", "人物", "old", RENWU_SUBJ, "一位青衫剑修", 864, 1152),
    ("Hc_old_scene", "场景", "old", SCENE_SUBJ, "隆冬正午", 1280, 720),
]


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


def swap_engine_positives(ver: str, types: list[str]) -> None:
    """ver=old: 引擎家指定型 positive 换 v4.1;ver=restore: 整文件回真源。"""
    if ver == "restore":
        shutil.copyfile(REPO_BASES, ENGINE_BASES)
        want = hashlib.sha256(REPO_BASES.read_bytes()).hexdigest()
        got = hashlib.sha256(ENGINE_BASES.read_bytes()).hexdigest()
        assert got == want, f"restore 后 SHA 不一致 {got} != {want}"
        print(f"[swap] restore sha={got[:12]}", flush=True)
        return
    data = json.loads(ENGINE_BASES.read_text(encoding="utf-8"))
    for it in data:
        if it["zh"] in types:
            it["positive"] = OLD_POS[it["zh"]]
    ENGINE_BASES.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[swap] ver={ver} types={types}", flush=True)


def entry_positive(zh: str) -> str:
    for it in json.loads(ENGINE_BASES.read_text(encoding="utf-8")):
        if it["zh"] == zh:
            return it["positive"]
    raise RuntimeError(f"引擎家找不到「{zh}」条目")


def run_arm(base: str, name: str, zh: str, ver: str, subject: str, subj_head: str,
            width: int, height: int, wf: dict, oi: dict) -> dict:
    overrides = {
        "12.seed": SEED,
        "53.width": width,
        "53.height": height,
        "80.base": zh,
        "63.per_layer_weights": AUTHOR_PLW,
        "50.value": subject,
    }
    graph = ui_to_api(wf, oi, overrides)
    graph["80"]["inputs"].pop("negative", None)

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
    want = NEW_ANCHOR[zh] if ver == "new" else OLD_ANCHOR[zh]
    other = OLD_ANCHOR[zh] if ver == "new" else NEW_ANCHOR[zh]
    ok = want in final and other not in final and subj_head in final
    if not ok:
        return {"name": name, "ran": False, "skip_reason": "final_positive 校验失败",
                "want": want, "final_head_80": final[:80], "prompt_id": pid}

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
            "base_type": zh, "base_ver": ver}


def main() -> int:
    ap = argparse.ArgumentParser(description="道劫底座 v5 纯画法四臂 A/B")
    ap.add_argument("--base-url", default="http://127.0.0.1:17000")
    ap.add_argument("--only", default="", help="只跑指定臂(逗号分隔)")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    only = {x.strip() for x in args.only.split(",") if x.strip()}

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)

    results = []
    try:
        old_swapped: set[str] = set()
        for name, zh, ver, subject, subj_head, w, h in RUNS:
            if only and name not in only:
                continue
            cur = entry_positive(zh)
            is_new = NEW_ANCHOR[zh] in cur
            if ver == "old":
                if zh not in old_swapped:
                    if is_new:
                        swap_engine_positives("old", [zh])
                    old_swapped.add(zh)
                elif not is_new:
                    pass  # 已换,维持
                elif is_new:
                    print(json.dumps({"fatal": f"臂 {name} 前置态异常:期望旧底座,现为新"}),
                          flush=True)
                    return 1
            else:  # new 臂必须在新版态
                if not is_new:
                    print(json.dumps({"fatal": f"臂 {name} 前置态异常:期望新底座,现为旧"}),
                          flush=True)
                    return 1
            results.append(run_arm(base, name, zh, ver, subject, subj_head, w, h, wf, oi))
    finally:
        swap_engine_positives("restore", [])

    audit_path = DOWNLOADS / "runs_audit.json"
    if audit_path.is_file() and only:
        prior = {r["name"]: r for r in
                 json.loads(audit_path.read_text(encoding="utf-8")).get("runs", [])}
        merged = {r["name"]: r for r in results}
        merged.update({k: v for k, v in prior.items() if k not in merged})
        results = list(merged.values())
    report = {"status": "done", "runs": results,
              "ok_count": sum(1 for r in results if r.get("ran")),
              "common": {"seed": SEED, "author_plw": AUTHOR_PLW,
                         "var_note": "唯一变量=底座文字(v4.1物象版 vs v5纯画法)"},
              "engine_bases_restored_sha12": hashlib.sha256(
                  ENGINE_BASES.read_bytes()).hexdigest()[:12]}
    (DOWNLOADS / "runs_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1), flush=True)
    return 0 if all(r.get("ran") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
