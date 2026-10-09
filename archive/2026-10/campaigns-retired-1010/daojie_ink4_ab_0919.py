#!/usr/bin/env python3
"""水墨四件 LoRA 五锚对拍跑阵(09-19,LoRA 治理 R2;引擎直排)。

对象 = 道劫 t2i 四件水墨向 LoRA:[82]淡彩线描 / [83]墨洗SumiWash /
[84]水彩湿画wash / [87]金雾GoldenMisty(注意:任务书沿 PRD 计划称 [85],
实际装机 id=87 —— commit 6c4278d,85/86 已被 MyDaojieLoras/showAnything
占用,按「不删不改既有节点」顺延;本脚本一律用真实 id 87)。

矩阵 29 跑(全部 payload 内联,工作流文件零改动):
  基线 2:base_scene / base_char —— 现常开链原样([47]Turbo+[81]服从度+
         [85]MyDaojieLoras 按型组;场景=67×1+金雾×0.6,人物=67×1+76×0.4+73×0.3)
  旁路一致 1:bypass87_scene —— 与 base_scene 完全同 payload([87] 旁路态),
         验证装机后零行为变化(AC1)+ 引擎确定性;逐字节一致为过
  主矩阵 24:{82,83,84,87}×{0.6,0.8,1.0}×两型,每跑内存里只激活该件
         (mode 4→0 翻转 wf 副本,盘上文件不动),其余新件维持旁路
  金雾互换对照 2:swap_scene_w06/w08 —— 场景型 [73]鎏金=0 且金雾@0.6/0.8

金雾防双叠(关键解释,台账必录):[85] 常开且按 daojie_loras.json 对场景
已装金雾×0.6 —— 场景型激活 [87] 的 5 跑(主矩阵 3 + 互换 2)若不处理会
金雾双叠(0.6+w),权重阶梯失真。处理 = 热调引擎侧 daojie_loras.json
摘除场景金雾条目(该文件设计即「热调即时生效」,mtime 失效+IS_CHANGED
穿透输出缓存,my_daojie_loras.py:28-48,84-88),跑完立即还原并 sha256
验证。人物型 [85] 无金雾,不需要热调。

互换对照的 [73]=0:场景型下鎏金结构性为零([73] 链上旁路 + daojie_loras.json
场景条目无 73),如实记录,不虚设激活。
swap_scene_w06/w08 与 87_scene_w06/w08 payload 完全一致 → 图像应逐字节
一致,兼作复现性对照;bypass87_scene 与 base_scene 同理。

校验四锚/跑:status=success;[62] 最终正向以 daojie_bases.json 对型
positive 开头 + 含主体句开头;[86] 回读 [85].applied 与预期清单逐字一致;
成图经 /view 下载双落 Downloads 与仓库 docs。任何失败如实记 ran=false。

纪律:提交前 /queue 让路(pending/running 非空先等,上限 10 分钟,超时
跳过该跑);单跑 /history 轮询上限 6 分钟;不读图,只落盘+sha。

用法:python3 apps/build/scripts/daojie_ink4_ab_0919.py [--base-url http://127.0.0.1:17000]
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
import struct
import sys
import time
import urllib.parse
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
ENGINE_LORAS_JSON = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
                     / "ComfyUI/custom_nodes/my-nodes/nodes/daojie_loras.json")
BASES_JSON = (REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json")
DOWNLOADS = Path.home() / "Downloads" / "daojie_lora_ab_0919"
WS_DIR = REPO / "docs/prompts/道劫_水墨四件对拍_0919"
CLIENT_ID = "daojie-ink4-ab-0919"
SEED = 42
WIDTH = HEIGHT = 1024
EXEC_TIMEOUT_S = 360   # 单跑上限 6 分钟(任务书口径)
IDLE_WAIT_MAX_S = 600  # 提交前队列礼让上限 10 分钟
POLL_S = 4
NEW_SLOTS = (82, 83, 84, 87)

# 主体句逐字取自 docs/prompts/道劫_九型主体句示例_0919.md §2 场景 / §1 人物
SUBJECTS = {
    "scene": ("暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，"
              "坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。"),
    "char": ("一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，"
             "眉目沉静中带一点锋芒；她立于山门石阶最上一级，右手轻按剑柄未拔，"
             "视线越过阶下云海望向远处，晨光自左侧斜照，衣袂被山风微微掀起。"),
}
SUBJECT_HEADS = {"scene": "暮春时节的黄昏", "char": "一位筑基后期的年轻女修"}
BASE_KEYS = {"scene": "场景", "char": "人物"}

APPLIED_SCENE_FULL = "场景:Krea2-细节滑杆DetailSlider_v1×1 + 金雾仙侠GoldenMisty×0.6"
APPLIED_SCENE_NOGM = "场景:Krea2-细节滑杆DetailSlider_v1×1"
APPLIED_CHAR = ("人物:Krea2-细节滑杆DetailSlider_v1×1 + Krea2-AsianMix_v4_TQD×0.4"
                " + Krea2-水墨武侠漆艺鎏金_v1×0.3")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def png_pixel_sha(b: bytes) -> str:
    """PNG 图像数据(IDAT 解压)sha —— 排除 tEXt 里嵌的 prompt 元数据,
    只比像素。纯字节处理,不读图。"""
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


def build_runs() -> list[dict]:
    runs = [
        {"name": "base_scene", "type": "scene", "slot": None, "w": None, "nogm": False},
        {"name": "bypass87_scene", "type": "scene", "slot": None, "w": None, "nogm": False},
        {"name": "base_char", "type": "char", "slot": None, "w": None, "nogm": False},
    ]
    for slot in NEW_SLOTS:
        for w in (0.6, 0.8, 1.0):
            runs.append({"name": f"{slot}_scene_w{int(w * 10):02d}", "type": "scene",
                         "slot": slot, "w": w, "nogm": slot == 87})
    for slot in NEW_SLOTS:
        for w in (0.6, 0.8, 1.0):
            runs.append({"name": f"{slot}_char_w{int(w * 10):02d}", "type": "char",
                         "slot": slot, "w": w, "nogm": False})
    runs.append({"name": "swap_scene_w06", "type": "scene", "slot": 87, "w": 0.6,
                 "nogm": True, "note": "金雾互换对照:[73]鎏金=0(结构性:链旁路+场景json无73)"})
    runs.append({"name": "swap_scene_w08", "type": "scene", "slot": 87, "w": 0.8,
                 "nogm": True, "note": "金雾互换对照:[73]鎏金=0(结构性:链旁路+场景json无73)"})
    return runs


def scene_json_without_goldmisty(orig: bytes) -> bytes:
    entries = json.loads(orig.decode("utf-8"))
    for e in entries:
        if isinstance(e, dict) and e.get("key") == "场景":
            before = list(e["loras"])
            e["loras"] = [x for x in e["loras"]
                          if "金雾" not in str(x.get("file", ""))]
            assert len(e["loras"]) == len(before) - 1, "场景金雾条目未按预期摘除"
    return json.dumps(entries, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


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


def node_output_text(entry: dict, nid: str) -> str | None:
    out = (entry.get("outputs") or {}).get(nid) or {}
    texts = out.get("text") or []
    if isinstance(texts, list) and texts and isinstance(texts[0], str):
        return texts[0]
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="水墨四件 LoRA 五锚对拍 29 跑")
    ap.add_argument("--base-url", default="http://127.0.0.1:17000")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    WS_DIR.mkdir(parents=True, exist_ok=True)

    wf_src = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    bases = {e["key"]: e for e in json.loads(BASES_JSON.read_text(encoding="utf-8"))}
    base_heads = {k: bases[v]["positive"] for k, v in BASE_KEYS.items()}
    oi = http_json(f"{base}/object_info", timeout=60)

    orig_json = ENGINE_LORAS_JSON.read_bytes()
    orig_sha = sha256_bytes(orig_json)
    nogm_json = scene_json_without_goldmisty(orig_json)
    nogm_sha = sha256_bytes(nogm_json)
    json_restored = True

    results = []
    for run in build_runs():
        name, typ, slot, w = run["name"], run["type"], run["slot"], run["w"]
        rec: dict = {"name": name, "type": typ,
                     "slot": slot, "weight": w, "ran": False}
        if run.get("note"):
            rec["note"] = run["note"]

        expected_applied = (APPLIED_SCENE_NOGM if (typ == "scene" and run["nogm"])
                            else APPLIED_SCENE_FULL if typ == "scene" else APPLIED_CHAR)
        rec["expected_applied_85"] = expected_applied

        wf_run = copy.deepcopy(wf_src)
        if slot is not None:
            for n in wf_run["nodes"]:
                if n["id"] == slot:
                    n["mode"] = 0  # 仅内存激活该件;盘上文件不动
        overrides = {
            "12.seed": SEED, "53.width": WIDTH, "53.height": HEIGHT,
            "50.value": SUBJECTS[typ], "80.base": BASE_KEYS[typ],
        }
        if slot is not None:
            overrides[f"{slot}.strength_model"] = w
        graph = ui_to_api(wf_run, oi, overrides)
        graph["80"]["inputs"].pop("negative", None)  # forceInput 可选槽未连线,照 0919 惯例弹出
        in_graph = [s for s in NEW_SLOTS if str(s) in graph]
        rec["lora_slots_in_api_graph"] = in_graph
        rec["liujin_73"] = ("结构零:链上旁路(mode=4)不入 API 图"
                            + (";场景 json 无 73 条目" if typ == "scene" else ""))
        ki = graph["12"]["inputs"]
        rec["key_inputs"] = {
            "seed": ki["seed"], "steps": ki["steps"], "cfg": ki["cfg"],
            "w": graph["53"]["inputs"]["width"], "h": graph["53"]["inputs"]["height"],
            "base": graph["80"]["inputs"]["base"],
            "63.per_layer_weights": graph["63"]["inputs"]["per_layer_weights"],
            "47.strength": graph["47"]["inputs"]["strength_model"],
            "81.strength": graph["81"]["inputs"]["strength_model"],
            **{f"{s}.strength": graph[str(s)]["inputs"]["strength_model"] for s in in_graph},
        }

        if not wait_idle(base):
            rec["skip_reason"] = f"引擎忙(礼让等待>{IDLE_WAIT_MAX_S}s)"
            results.append(rec)
            print(f"[ink4] {name} SKIP 引擎忙", flush=True)
            continue

        err: tuple[str, object] | None = None  # (skip_reason, detail|None);不甩异常跑数
        try:
            if run["nogm"]:
                ENGINE_LORAS_JSON.write_bytes(nogm_json)
                rec["engine_loras_json_sha_during_run"] = nogm_sha
            resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID},
                             timeout=60)
            if resp.get("node_errors"):
                err = ("node_errors", json.dumps(resp["node_errors"], ensure_ascii=False)[:800])
            else:
                pid = resp["prompt_id"]
                rec["prompt_id"] = pid
                entry, wall = wait_done(base, pid)
                rec["wall_s"] = wall
                status = (entry or {}).get("status", {})
                if entry is None:
                    err = (f"超时(>{EXEC_TIMEOUT_S}s)", None)
                elif status.get("status_str") != "success":
                    errs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
                    err = ("execution_failed", errs[:1])
                else:
                    final = node_output_text(entry, "62")
                    applied = node_output_text(entry, "86")
                    ok_head = bool(final and final.startswith(base_heads[typ]))
                    ok_subj = bool(final and SUBJECT_HEADS[typ] in final)
                    ok_applied = bool(applied and applied == expected_applied)
                    rec["checks"] = {"final_head_ok": ok_head, "subject_ok": ok_subj,
                                     "applied_85_ok": ok_applied, "applied_85_actual": applied}
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
                        fname = f"{name}.png"
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
                        except Exception as exc:  # 像素sha仅对照用,失败不翻案
                            rec["pixel_sha256"] = None
                            rec["pixel_sha_error"] = str(exc)[:120]
        except Exception as exc:  # 网络等意外:如实记 ran=false,不中断整个跑阵
            err = (f"异常:{type(exc).__name__}", str(exc)[:300])
        finally:
            if run["nogm"]:
                ENGINE_LORAS_JSON.write_bytes(orig_json)
                back = sha256_bytes(ENGINE_LORAS_JSON.read_bytes())
                json_restored = json_restored and back == orig_sha
                rec["engine_loras_json_restored_sha_ok"] = back == orig_sha
        if err is not None:
            rec["skip_reason"] = err[0]
            if err[1] is not None:
                rec["detail"] = err[1]
            print(f"[ink4] {name} FAIL {err[0]}", flush=True)
        else:
            print(f"[ink4] {name} 完成 wall={rec.get('wall_s')}s bytes={rec.get('bytes')}",
                  flush=True)
        results.append(rec)

    # ── 一致性对照(同 payload 应逐字节一致;跨 payload 比像素 sha) ──
    by = {r["name"]: r for r in results}
    def pair(a: str, b: str, pixel: bool = False) -> dict | None:
        ra, rb = by.get(a), by.get(b)
        if not (ra and rb and ra.get("ran") and rb.get("ran")):
            return {"a": a, "b": b, "comparable": False}
        k = "pixel_sha256" if pixel else "sha256"
        va, vb = ra.get(k), rb.get(k)
        if va is None or vb is None:
            return {"a": a, "b": b, "comparable": False, "reason": f"{k} 缺失"}
        return {"a": a, "b": b, "comparable": True, "metric": k, "identical": va == vb}
    identity = {
        "bypass87_vs_base_scene(AC1零行为变化,同payload)": pair("bypass87_scene", "base_scene"),
        "swap_w06_vs_87_scene_w06(复现性,同payload)": pair("swap_scene_w06", "87_scene_w06"),
        "swap_w08_vs_87_scene_w08(复现性,同payload)": pair("swap_scene_w08", "87_scene_w08"),
        "87_scene_w06_vs_base_scene(换槽位等价性,跨payload比像素)": pair("87_scene_w06", "base_scene", pixel=True),
    }

    report = {
        "status": "done",
        "task": "水墨四件 LoRA 五锚对拍(09-19 LoRA治理 R2)",
        "interpretations": {
            "金雾节点id": "任务书/PRD 称 [85];实际装机 id=87(commit 6c4278d,85/86 被 "
                          "MyDaojieLoras/showAnything 占用),全矩阵按真实 id 执行",
            "金雾防双叠": "[85]MyDaojieLoras(常开)按 daojie_loras.json 对场景装金雾×0.6;"
                          "场景+[87] 5 跑热调引擎侧 json 摘除该条(设计内机制),跑后还原+sha验证",
            "互换对照_73归零": "场景型下 [73] 结构性为零(链上旁路不入API图+场景json无73条目)",
            "旁路一致跑": "bypass87_scene 与 base_scene 同 payload,逐字节一致=装机零行为变化(AC1)",
            "同payload互换跑": "swap_scene_w06/w08 与 87_scene_w06/w08 payload 相同,兼作复现性对照",
        },
        "common": {"seed": SEED, "width": WIDTH, "height": HEIGHT,
                   "steps_cfg": "工作流现值(见各跑 key_inputs,应为 4/1)",
                   "subject_source": "docs/prompts/道劫_九型主体句示例_0919.md §1人物/§2场景 逐字",
                   "engine_loras_json_orig_sha256": orig_sha},
        "engine_loras_json_restored": json_restored,
        "identity_checks": identity,
        "runs": results,
        "runs_total": len(results),
        "ok_count": sum(1 for r in results if r.get("ran")),
    }
    (WS_DIR / "runs_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"ok_count": report["ok_count"], "runs_total": report["runs_total"],
                      "identity": identity, "json_restored": json_restored},
                     ensure_ascii=False, indent=1), flush=True)
    ok = (report["ok_count"] == report["runs_total"]) and json_restored
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
