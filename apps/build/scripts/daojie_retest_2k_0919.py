#!/usr/bin/env python3
"""道劫消融处方终验复测(09-19 v7/v8/v9):三型跨验,2K 原生跟随。

处方(已应用进工作流文件,本脚本零改动只读):
  [46] Afterlight mode=4 旁路(电影化主因);[78] 电影感 ×0.5;[63] 双口径
  (widgets_values+widgets_values_named)均全 1.0 中性;其余照旧。

三跑(用户裁定:处方是全链改动,只验场景不够,须跨型):
  v7_retest_2k    [80]=场景,主体句=「暮春时节的黄昏…」,对比九型轮场景.png
  v8_retest_人物  [80]=人物,主体句=「一位筑基后期的年轻女修…」,对比人物.png
  v9_retest_美宣  [80]=美宣,主体句=「雷劫降临的至暗时刻…」,对比美宣.png
共同:seed=42,步数/cfg 工作流现值(4/1),每跑从文件现状重新转换(不复用旧
payload,46 旁路已改图结构);分辨率走工作流原生跟随——[61] ResolutionSelector
保留进 API 图(消融轮被 SKIP 跳过、尺寸内联 1MP;本轮放行,[80]→aspect/mp→
[61]→[53] 全链引擎自算 4.2MP,对齐用户看到细线布满的 4.2MP 现象)。

转换复用 daojie_livefire_0917.ui_to_api,唯 SKIP_NODES 打补丁为 {20}(放行
[61]);[80].negative 未连线照例弹出(位置回退误填 widgets_values[0])。
纪律:每跑提交前队列礼让(上限 10 分钟);单跑轮询上限 15 分钟;[62] 回读最终
正向校验(以该型底座开头+含主体句锚);成图落 ~/Downloads/daojie_ablation_0919/
vN.png + 工作区 docs/prompts/道劫_九型实弹_0919/ablation/ 同名,并回填
runs_audit.json 的 runs 数组(增补条目,不动原始记录)。任何失败如实报。

用法:python3 apps/build/scripts/daojie_retest_2k_0919.py [--base-url http://127.0.0.1:17000] [--only v7_retest_2k]
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_livefire_0917 as lf  # noqa: E402
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

# 本轮放行 [61](原生分辨率跟随);种子件 [20] 仍跳,seed 内联进 [12]
lf.SKIP_NODES = {20}

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
DOWNLOADS = Path.home() / "Downloads" / "daojie_ablation_0919"
WS_COPY = REPO / "docs/prompts/道劫_九型实弹_0919" / "ablation"
CLIENT_ID = "daojie-retest2k-0919"
SEED = 42
EXEC_TIMEOUT_S = 900   # 2K 4.2MP 约 3.5 分钟,上限 15 分钟
IDLE_WAIT_MAX_S = 600
POLL_S = 5

RUNS = [
    ("v7_retest_2k", "场景", "现代修仙游戏的场景设定资产",
     "暮春时节的黄昏,废弃的上古祭坛深藏在群山环抱的谷底,九根断裂的石柱围成半圆,"
     "坛心一泓浅潭映出残阳;谷口白雾正缓缓漫入,远山三重叠影渐次淡去。",
     "暮春时节的黄昏"),
    ("v8_retest_人物", "人物", "现代修仙游戏的角色立绘资产",
     "一位筑基后期的年轻女修,青玉色道袍束月白腰带,长发半束只簪一支素银簪,眉目沉静中带一点锋芒;"
     "她立于山门石阶最上一级,右手轻按剑柄未拔,视线越过阶下云海望向远处,晨光自左侧斜照,"
     "衣袂被山风微微掀起。",
     "一位筑基后期的年轻女修"),
    ("v9_retest_美宣", "美宣", "现代修仙游戏的主视觉资产",
     "雷劫降临的至暗时刻,白衣剑修独立孤峰之巅,周身剑气化作淡金色光罩,九道紫雷自翻墨般的劫云中劈落,"
     "他在最后一瞬反身拔剑迎击,衣袍与剑穗在罡风中猎猎狂舞;远景群山在雷光明灭中沉浮。",
     "雷劫降临的至暗时刻"),
    # 09-19 移交包追加:道具型重跑(00079 病历=柔水彩0.5开着+4步cfg1+四宫格弱项;
    # 文件现状 [68] 柔水彩已 mode=4 旁路,处方链在位,零改动只读)。主体句取
    # daojie_batch_engine_0918.py 09-18 批量件原句(古铜飞剑),对拍上午 道具.png;
    # 四宫格格数漂移=已知 t2i 弱项,判读降预期(版式/画风/名词命中为主)。
    ("v10_retest_道具", "道具", "现代修仙游戏的道具设定板资产",
     "一柄古铜飞剑悬于画面正中，剑身以细而稳的墨线勾勒，剑格纹样旧金点缀，剑身罩一层赭石薄染；"
     "剑尖旁淡墨云气缭绕流转；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。",
     "一柄古铜飞剑"),
    # 09-19 晚底座措辞修订验证:场景正向换「晕染为主/线只锚主体轮廓」新句
    # (v2.2 措辞修订,daojie_bases.json+文档围栏双源已改)。同 seed 同主体句,
    # 对拍 v7_retest_2k.png(旧措辞)看前景细线密度是否让位于晕染。不覆盖 v7。
    ("v11_scene_reword", "场景", "现代修仙游戏的场景设定资产",
     "暮春时节的黄昏,废弃的上古祭坛深藏在群山环抱的谷底,九根断裂的石柱围成半圆,"
     "坛心一泓浅潭映出残阳;谷口白雾正缓缓漫入,远山三重叠影渐次淡去。",
     "暮春时节的黄昏"),
]


def wait_idle(base: str) -> bool:
    t0 = time.time()
    while time.time() - t0 < IDLE_WAIT_MAX_S:
        q = http_json(f"{base}/queue", timeout=10)
        if not q.get("queue_running") and not q.get("queue_pending"):
            return True
        time.sleep(5)
    return False


def wait_done(base: str, pid: str) -> tuple[dict | None, float]:
    t0 = time.time()
    while time.time() - t0 < EXEC_TIMEOUT_S:
        hist = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in hist:
            return hist[pid], round(time.time() - t0, 1)
        time.sleep(POLL_S)
    return None, round(time.time() - t0, 1)


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


def append_audit(record: dict) -> None:
    audit_path = WS_COPY / "runs_audit.json"
    if not audit_path.exists():
        return
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    audit["runs"] = [r for r in audit.get("runs", []) if r.get("name") != record.get("name")] + [record]
    audit["ok_count"] = sum(1 for r in audit["runs"] if r.get("ran"))
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="道劫处方终验三型复测(场景/人物/美宣)")
    ap.add_argument("--base-url", default="http://127.0.0.1:17000")
    ap.add_argument("--only", default=None, help="只跑指定名(如 v7_retest_2k),默认全跑")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    WS_COPY.mkdir(parents=True, exist_ok=True)

    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))  # 文件现状现读,不复用旧 payload
    oi = http_json(f"{base}/object_info", timeout=60)
    # 新版 comfy-core ResolutionSelector 带 optional "preview"(RESOLUTION_PREVIEW,
    # socketless 纯显示件);UI 文件存的 widgets_values 还是旧三件 → 位置回退对不齐。
    # 它不参与执行,从 object_info 副本里摘除(仅本次转换内存态,不动引擎不动文件)。
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)

    results = []
    for name, base_key, pos_head, subject, subj_anchor in RUNS:
        if args.only and name != args.only:
            continue
        overrides = {
            "12.seed": SEED,        # 内联字面量(绕开 rgthree 种子件 [20])
            "50.value": subject,    # 该型主体句(原样)
            "80.base": base_key,    # 底座下拉(逐字)
            # 注意:无 53.width/height 覆盖——[61] 已放行,分辨率原生跟随 4.2MP
        }
        graph = ui_to_api(wf, oi, overrides)
        graph["80"]["inputs"].pop("negative", None)  # 未连线可选槽,位置回退误填,弹出

        # 图结构自检:46/78 须不在图内(文件现状 mode=4 双旁路——16:40 文件态比
        # 协调方口径更严:78 整关而非 ×0.5;63 双口径=作者档而非中性,按「从现状
        # 转换」指令如实跑并把实际值记录在案)、53 尺寸走 [61] 链
        assert "46" not in graph, "[46] 应已旁路不出现在 API 图"
        assert "78" not in graph, "[78] 文件现状已旁路,不应出现在 API 图"
        key_inputs = {
            "12.seed": graph["12"]["inputs"]["seed"],
            "12.steps": graph["12"]["inputs"]["steps"],
            "12.cfg": graph["12"]["inputs"]["cfg"],
            "53.width": graph["53"]["inputs"]["width"],
            "53.height": graph["53"]["inputs"]["height"],
            "80.base": graph["80"]["inputs"]["base"],
            "63.per_layer_weights": graph["63"]["inputs"]["per_layer_weights"],
            "67.strength_model": graph["67"]["inputs"]["strength_model"],
            "73.strength_model": graph["73"]["inputs"]["strength_model"],
            "81.strength_model": graph["81"]["inputs"]["strength_model"],
        }
        assert key_inputs["53.width"] == ["61", 0] and key_inputs["53.height"] == ["61", 1], \
            f"[53] 尺寸应走 [61] 原生跟随,实际 {key_inputs['53.width']}/{key_inputs['53.height']}"
        print(f"[retest] {name} 图结构自检通过:" + json.dumps(key_inputs, ensure_ascii=False), flush=True)

        if not wait_idle(base):
            results.append({"name": name, "ran": False,
                            "skip_reason": f"引擎忙(礼让等待>{IDLE_WAIT_MAX_S}s)"})
            continue

        t0 = time.time()
        resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
        if resp.get("node_errors"):
            results.append({"name": name, "ran": False, "skip_reason": "node_errors",
                            "detail": json.dumps(resp["node_errors"], ensure_ascii=False)[:800]})
            continue
        pid = resp["prompt_id"]
        print(f"[retest] {name} 已提交 prompt_id={pid}", flush=True)
        entry, wall = wait_done(base, pid)
        if entry is None:
            results.append({"name": name, "ran": False, "skip_reason": f"超时(>{EXEC_TIMEOUT_S}s)",
                            "prompt_id": pid})
            continue
        if entry.get("status", {}).get("status_str") != "success":
            errs = [m for m in entry.get("status", {}).get("messages", []) if m[0] == "execution_error"]
            results.append({"name": name, "ran": False, "skip_reason": "execution_failed",
                            "detail": errs[:1], "prompt_id": pid})
            continue

        final = final_positive(entry)
        ok_head = bool(final and final.startswith(pos_head))
        ok_subj = bool(final and subj_anchor in final)
        if not (ok_head and ok_subj):
            results.append({"name": name, "ran": False, "skip_reason": "final_positive 校验失败",
                            "head_ok": ok_head, "subj_ok": ok_subj,
                            "final_head_80": (final or "")[:80], "prompt_id": pid})
            continue

        image = first_image(entry)
        if image is None:
            results.append({"name": name, "ran": False, "skip_reason": "history 无图片输出",
                            "prompt_id": pid})
            continue
        q = (f"filename={urllib.parse.quote(image['filename'])}"
             f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}&type=output")
        png = http_bytes(f"{base}/view?{q}")
        out_dl = DOWNLOADS / f"{name}.png"
        out_dl.write_bytes(png)
        out_ws = WS_COPY / f"{name}.png"
        shutil.copyfile(out_dl, out_ws)

        record = {"name": name, "ran": True, "prompt_id": pid, "wall_s": wall,
                  "bytes": len(png), "output": str(out_dl), "ws_copy": str(out_ws),
                  "engine_image": image["filename"], "key_inputs": key_inputs,
                  "final_positive_len": len(final or "")}
        append_audit(record)
        results.append(record)
        print(f"[retest] {name} 完成 wall={wall}s -> {out_dl.name}", flush=True)

    print(json.dumps({"status": "done", "results": results}, ensure_ascii=False, indent=1), flush=True)
    return 0 if results and all(r.get("ran") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
