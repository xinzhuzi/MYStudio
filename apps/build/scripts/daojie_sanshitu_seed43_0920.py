#!/usr/bin/env python3
"""九型实弹·配方版(09-19 九型配方 R6;引擎直排,seed=42,原生分辨率)。

九型各 1 张,按 daojie_bases.json v3 新配方出图(K2-文生图-道劫.json 主链,
[90] MyDaojieLoraStack preset=跟随底座型+[80].base 联动;画风槽点亮=对拍定谳):
  人物/美宣/三视图/高清人脸/表情差分=三件现值;场景=+墨洗0.8+金雾0.6;
  分镜=+淡彩线描0.5;概念气氛=+墨洗0.7+金雾0.6;道具=细节+鎏金。
分辨率=[80]→[61] 联动的原生档(core ResolutionSelector 公式复刻,multiple=8):
  3:4@4.2→1816×2424;16:9@4.2→2800×1576;21:9@4.2→3208×1376;1:1@1.0→1024×1024。
主体句=docs/prompts/道劫_九型主体句示例_0919.md 九条逐字。

校验四锚/跑:status=success;[62] 最终正向以 daojie_bases 对型 positive 开头+含
主体句头;[86] 回读 [90].applied 与栈 json 预期清单逐字一致;成图 /view 下载
双落 Downloads 与仓库 docs;runs_audit.json 台账(ink4 同款纪律)。
对照基线=docs/prompts/道劫_九型实弹_0919/(09:26-10:08 旧链九张)。
用法:python3 apps/build/scripts/daojie_nineform_recipe_livefire_0919.py [--base-url …]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
import sys
import time
import urllib.parse
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_livefire_0917 as lf  # noqa: E402
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

lf.SKIP_NODES = {20, 61, 88}  # 种子/分辨率/分组旁路器 UI 件内联接管

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
BASES_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
STACK_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json"
DOWNLOADS = Path.home() / "Downloads" / "daojie_nineform_recipe_0919"
WS_DIR = REPO / "docs/prompts/道劫_九型实弹_配方版_0919"
CLIENT_ID = "daojie-nineform-recipe-0919"
SEED = 43
EXEC_TIMEOUT_S = 600
IDLE_WAIT_MAX_S = 600
POLL_S = 4

# core comfy_extras/nodes_resolution.py ASPECT_RATIOS + execute 公式复刻(multiple=8)
ASPECTS = {
    "1:1 (Square)": (1, 1),
    "3:4 (Portrait Standard)": (3, 4),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}


def native_px(aspect_label: str, megapixels: float, multiple: int = 8) -> tuple[int, int]:
    wr, hr = ASPECTS[aspect_label]
    total = megapixels * 1024 * 1024
    scale = math.sqrt(total / (wr * hr))
    return (round(wr * scale / multiple) * multiple,
            round(hr * scale / multiple) * multiple)


# 主体句逐字取自 docs/prompts/道劫_九型主体句示例_0919.md §1-§9
SUBJECTS = {
    "人物": "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，右手轻按剑柄未拔，视线越过阶下云海望向远处，晨光自左侧斜照，衣袂被山风微微掀起。",
    "场景": "暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。",
    "道具": "一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹，剑格铸成兽首衔环，剑柄缠深红丝绳，穗尾垂一枚带裂纹的灵玉；细节特写一格聚焦剑身近格处的旧伤裂纹与缠绕其上的金色修补纹。",
    "美宣": "雷劫降临的至暗时刻，白衣剑修独立孤峰之巅，周身剑气化作淡金色光罩，九道紫雷自翻墨般的劫云中劈落，他在最后一瞬反身拔剑迎击，衣袍与剑穗在罡风中猎猎狂舞；远景群山在雷光明灭中沉浮。",
    "三视图": "同一位玄色劲装的青年刀修三视图资产板：纯白无色背景、无任何场景元素；横幅多格并排，每格一人一形态互不重复——须含上半身特写（底缘止腰）、正面全身、标准正侧九十度、纯背面全身，可再加四分之三背侧回望、四分之三斜侧等补充形态；各全身格同以自然站姿、双臂拢袖自然下垂，腰侧佩刀不持握；头顶至脚底跨格对齐，头身肩宽一致，面容发型服装肤色跨格完全一致；无重复形态、无无关个体，资产参考图，非海报。",
    "高清人脸": "一位筑基后期的年轻女修面容特写：眉目沉静中带一点锋芒，长发半束只簪一支素银簪，几缕碎发垂在颊边；头顶至锁骨、正面平视，神情沉静，柔和顶光勾勒面部立体轮廓。",
    "分镜剧情图": "山雨欲来的渡口，老船工收篙回望，身后的少年修士第一次背起行囊离乡；乌云压江，渡口一盏灯笼是画面唯一的暖色，两人的目光都投向江雾深处若隐若现的仙山轮廓。",
    "表情差分": "同一位红衣女修的九宫格表情差分，九格情绪与五官状态——沉静：双目平和微垂、眉舒展、唇线平直；含笑：眼角弯起、嘴角上扬轻抿、眉梢微挑；怒：剑眉倒竖、怒目圆睁、牙关紧咬嘴角下压；哀：眉梢下垂呈八字、眼睑低垂含泪光、嘴角下弯；惧：眉毛高挑向眉心收拢、双眼圆睁、唇微张发颤；凌厉：双眼眯起、眉峰锐利下压、嘴角紧抿；惊讶：眉毛高高挑起、双眼睁大、唇微张成小圆；害羞：双颊染红晕、眼帘低垂、嘴角含羞轻抿；决然：目光坚定直视、眉宇紧锁、嘴角平直；三行三列共九格，各格头部角度与光源方向保持一致。",
    "概念气氛图": "千年一次的灵潮涨落之夜，悬浮的碎裂古殿群沐浴在青蓝色灵光中，万千萤火状灵尘随气流缓缓升腾；画面九成留给静谧的夜与雾，只余殿群一角与一株横生孤松的剪影。",
}
SUBJECT_HEADS = {k: v[:12] for k, v in SUBJECTS.items()}


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def png_pixel_sha(b: bytes) -> str:
    assert b[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    off, idat = 8, []
    while off < len(b):
        (ln,) = struct.unpack(">I", b[off:off + 4])
        ctype = b[off + 4:off + 8]
        if ctype == b"IDAT":
            idat.append(b[off + 8:off + 8 + ln])
        off += 12 + ln
        if ctype == b"IEND":
            break
    return sha256_bytes(zlib.decompress(b"".join(idat)))


def expected_applied(zh: str, slots: list) -> str:
    """[90].applied 预期文本(my_daojie_lora_stack.run 同式复刻,单源=栈 json)。"""
    plan = [(Path(s["file"]).stem, s["presets"][zh]["weight"])
            for s in slots if s["presets"][zh]["on"]]
    total = len([s for s in slots if s.get("file")])
    return (f"跟随底座型·{zh}({len(plan)}/{total}):"
            + " + ".join(f"{stem}×{w:g}" for stem, w in plan))


def wait_idle(base: str) -> bool:
    t0 = time.time()
    while time.time() - t0 < IDLE_WAIT_MAX_S:
        try:
            q = http_json(f"{base}/queue", timeout=10)
        except Exception as exc:  # 引擎重启窗口(09-19 实录:中途崩溃自动拉起):预算内重试
            print(f"[九型] queue 探测失败({type(exc).__name__}),10s 后重试", flush=True)
            time.sleep(10)
            continue
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


def node_output_text(entry: dict, nid: str) -> str | None:
    out = (entry.get("outputs") or {}).get(nid) or {}
    texts = out.get("text") or []
    if isinstance(texts, list) and texts and isinstance(texts[0], str):
        return texts[0]
    return None


def probe_base() -> str:
    for port in (17000, 17001):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats",
                                        timeout=3):
                return f"http://127.0.0.1:{port}"
        except Exception:
            continue
    raise RuntimeError("引擎 17000/17001 双口均无监听")


def main() -> int:
    import urllib.request
    ap = argparse.ArgumentParser(description="九型实弹·配方版 9 跑")
    ap.add_argument("--base-url", default=probe_base())
    ap.add_argument("--only", nargs="*", default=None,
                    help="只跑指定型(引擎中断续跑);审计合并进既有 runs_audit.json")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    WS_DIR.mkdir(parents=True, exist_ok=True)

    selected = list(args.only) if args.only else list(SUBJECTS)

    wf_src = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    bases = {e["zh"]: e for e in json.loads(BASES_JSON.read_text(encoding="utf-8"))}
    slots = json.loads(STACK_JSON.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop(
        "preview", None)

    t_all = time.time()
    results = []
    for zh in selected:  # json 条目序(或 --only 续跑子集)
        rec: dict = {"name": zh, "ran": False,
                     "recipe": " + ".join(
                         f"{Path(i['file']).name}×{i['weight']:g}"
                         for i in bases[zh]["lora_recipe"])}
        w, h = native_px(bases[zh]["aspect_ratio"], bases[zh]["megapixels"])
        ov = bases[zh].get("resolution_override")
        if isinstance(ov, list) and len(ov) == 2:
            w, h = int(ov[0]), int(ov[1])  # 09-20 三视图 A 案:先例直填
        rec["native"] = f"{w}×{h}"
        overrides = {"12.seed": SEED, "53.width": w, "53.height": h,
                     "50.value": SUBJECTS[zh], "80.base": zh}
        graph = ui_to_api(json.loads(json.dumps(wf_src)), oi, overrides)
        graph["80"]["inputs"].pop("negative", None)  # 0919 惯例:可选槽未连线弹出
        rec["key_inputs"] = {
            "seed": graph["12"]["inputs"]["seed"], "steps": graph["12"]["inputs"]["steps"],
            "cfg": graph["12"]["inputs"]["cfg"], "w": w, "h": h, "base": zh,
            "preset": graph["90"]["inputs"]["preset"],
            "90.base_link": graph["90"]["inputs"].get("base"),
        }
        want_applied = expected_applied(zh, slots)
        rec["expected_applied_90"] = want_applied

        if not wait_idle(base):
            rec["skip_reason"] = f"引擎忙(礼让等待>{IDLE_WAIT_MAX_S}s)"
            results.append(rec)
            print(f"[九型] {zh} SKIP 引擎忙", flush=True)
            continue

        err = None
        try:
            resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID},
                             timeout=60)
            if resp.get("node_errors"):
                err = ("node_errors",
                       json.dumps(resp["node_errors"], ensure_ascii=False)[:800])
            else:
                pid = resp["prompt_id"]
                rec["prompt_id"] = pid
                entry, wall = wait_done(base, pid)
                rec["wall_s"] = wall
                status = (entry or {}).get("status", {})
                if entry is None:
                    err = (f"超时(>{EXEC_TIMEOUT_S}s)", None)
                elif status.get("status_str") != "success":
                    errs = [m for m in status.get("messages", [])
                            if m[0] == "execution_error"]
                    err = ("execution_failed", errs[:1])
                else:
                    final = node_output_text(entry, "62")
                    applied = node_output_text(entry, "86")
                    ok_head = bool(final and final.startswith(bases[zh]["positive"]))
                    ok_subj = bool(final and SUBJECT_HEADS[zh] in final)
                    ok_applied = bool(applied and applied == want_applied)
                    rec["checks"] = {"final_head_ok": ok_head, "subject_ok": ok_subj,
                                     "applied_90_ok": ok_applied,
                                     "applied_90_actual": applied}
                    image = first_image(entry)
                    if not (ok_head and ok_subj and ok_applied):
                        err = ("校验失败(正向头/主体句/按型清单)", (final or "")[:80])
                    elif image is None:
                        err = ("history 无图片输出", None)
                    else:
                        q = (f"filename={urllib.parse.quote(image['filename'])}"
                             f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}"
                             f"&type=output")
                        png = http_bytes(f"{base}/view?{q}")
                        fname = f"{zh}.png"
                        out_dl, out_ws = DOWNLOADS / fname, WS_DIR / fname
                        out_dl.write_bytes(png)
                        shutil.copyfile(out_dl, out_ws)
                        rec.update({"ran": True, "bytes": len(png),
                                    "sha256": sha256_bytes(png),
                                    "output": str(out_dl), "ws_copy": str(out_ws),
                                    "engine_image": image["filename"],
                                    "final_positive_len": len(final or "")})
                        try:
                            rec["pixel_sha256"] = png_pixel_sha(png)
                        except Exception as exc:
                            rec["pixel_sha256"] = None
                            rec["pixel_sha_error"] = str(exc)[:120]
        except Exception as exc:
            err = (f"异常:{type(exc).__name__}", str(exc)[:300])
        if err is not None:
            rec["skip_reason"] = err[0]
            if err[1] is not None:
                rec["detail"] = err[1]
            print(f"[九型] {zh} FAIL {err[0]}", flush=True)
        else:
            print(f"[九型] {zh} 完成 wall={rec.get('wall_s')}s "
                  f"bytes={rec.get('bytes')} native={rec['native']}", flush=True)
        results.append(rec)

    if args.only:  # 续跑:并回既有审计(同名覆盖,保序;引擎中断史如实保留)
        audit_path = WS_DIR / "runs_audit.json"
        if audit_path.is_file():
            prev = json.loads(audit_path.read_text(encoding="utf-8"))
            by_name = {r["name"]: r for r in prev.get("runs", [])}
            for r in results:
                by_name[r["name"]] = r
            prev["runs"] = [by_name[n] for n in SUBJECTS if n in by_name]
            prev["runs_total"] = len(prev["runs"])
            prev["ok_count"] = sum(1 for r in prev["runs"] if r.get("ran"))
            prev["resume_note"] = (f"--only 续跑 {args.only}(首轮引擎连接中断,"
                                   "重启后 17001 续跑,既往各跑记录原样保留)")
            prev["total_wall_s"] = round(prev.get("total_wall_s", 0)
                                         + (time.time() - t_all), 1)
            audit_path.write_text(
                json.dumps(prev, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"runs_total": prev["runs_total"],
                              "ok_count": prev["ok_count"]}, ensure_ascii=False))
            return 0 if prev["ok_count"] == len(prev["runs"]) else 1

    ok = [r for r in results if r.get("ran")]
    report = {
        "status": "done",
        "task": "九型实弹·配方版(09-19 九型配方 R6)",
        "interpretations": {
            "配方": "daojie_bases.json v3 lora_recipe(画风槽=09-19 水墨四件对拍定谳 v0.2 待用户终审);"
                    "全局件 turbo×1/projector×0.01 恒挂不入配方",
            "主链": "K2-文生图-道劫.json [90]MyDaojieLoraStack preset=跟随底座型+[80].base 联动",
            "分辨率": "[80]→[61] 原生档(core ResolutionSelector 公式复刻,multiple=8;1MP=1024²)",
            "对照基线": "docs/prompts/道劫_九型实弹_0919/(09-19 旧链九张,seed=42/steps=4/cfg=1 同口径)",
        },
        "common": {"seed": SEED, "steps_cfg": "工作流现值 4/1(速度档,对齐基线)",
                   "subject_source": "docs/prompts/道劫_九型主体句示例_0919.md 九条逐字",
                   "bases_json_sha256": sha256_bytes(BASES_JSON.read_bytes()),
                   "stack_json_sha256": sha256_bytes(STACK_JSON.read_bytes())},
        "runs": results, "runs_total": len(results), "ok_count": len(ok),
        "total_wall_s": round(time.time() - t_all, 1),
    }
    (WS_DIR / "runs_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"runs_total": len(results), "ok_count": len(ok),
                      "wall_s": report["total_wall_s"]}, ensure_ascii=False))
    return 0 if len(ok) == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
