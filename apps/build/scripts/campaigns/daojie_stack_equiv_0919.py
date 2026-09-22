#!/usr/bin/env python3
"""道劫 LoRA 栈等价性双跑(09-19 LoRA快速启停 R4;MyDaojieLoraStack 切主链硬门禁)。

对 K2-文生图-道劫.json(工作树现态:[47][81] 常开 + [85] MyDaojieLoras 按型
装组=人物 67×1→76×0.4→73×0.3,其余 12 件旁路)构造五组同 seed(42)同画幅
(1280×720 内联 [53],绕开 [61])payload:
  A_current         现链原样(ui_to_api,旁路穿透)——等价性基准
  B_stack_default   栈节点版:MyDaojieLoraStack preset=跟随底座型+base=[80]槽4,
                    14 槽 enable 全 True/权重=default_weight(=默认组)
  C_bypass_baseline 现链全旁路(47/81/85 也转 mode=4)——纯透传基线
  D_stack_all_off   栈节点 preset=专家·全自定义 + 14 槽 enable 全 False(真关)
  E_stack_weight0   栈节点 preset=专家·全自定义 + 14 槽全开×权重 0(照常加载)
  (+) P1/P2 顺序探针:67→73→76 vs 67→76→73(角色设定切栈的序变风险取证,
      权重取角色设定现值 1/0.4/1.0;--with-order-probe 开)
门禁(任务书口径):
  硬门禁 G1 B 像素==A 像素(默认组=现链,逐字节);G2 D 像素==C 像素(全关=旁路基线);
  记录项 计时 wall(D)≪wall(E)(enable=false 真关 vs weight=0,「更快」证据)。
  信息性 G3 E vs C(09-19 实测**不等**:strength=0 走引擎补丁路径仍改字节,
  单件 turbo×0 亦然——model_patcher 补丁路径 dtype 往返副作用;即 weight=0
  非输出中性,enable=false 才是真关)、G5 顺序探针(实测不等=链序敏感实证)。
像素比对=PNG IDAT 解压 sha(ink4 先例 png_pixel_sha,排除 tEXt 嵌的 prompt
元数据——A/B 图内嵌 prompt 必不同,整文件 sha 仅记录不作判据)。
图落 ~/Downloads/daojie_stack_equiv_0919/ + runs_audit.json。
用法:python3 apps/build/scripts/daojie_stack_equiv_0919.py [--with-order-probe]
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import struct
import sys
import time
import urllib.parse
import urllib.request
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_livefire_0917 as lf  # noqa: E402
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

lf.SKIP_NODES = {20, 61, 88}  # 种子/分辨率/分组旁路器 UI 件由内联字面量接管
                              # ([88] Fast Groups Bypasser=纯画布控制件,R1 后新增,
                              #  object_info 无此键——ablation 惯例的同类延伸)

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
STACK_JSON = (REPO / "apps/backend/engines/comfyui/my_nodes/nodes"
              / "daojie_lora_stack.json")
DOWNLOADS = Path.home() / "Downloads" / "daojie_stack_equiv_0919"
CLIENT = "daojie-stack-equiv-0919"
SEED = 42
WIDTH, HEIGHT = 1280, 720
EXEC_TIMEOUT_S = 600
IDLE_WAIT_MAX_S = 600
POLL_S = 0.5          # 计时精度:0.5s 轮询
STACK_NID = "90"
CURRENT_LORA_API_IDS = ("47", "81", "85")   # 现链非旁路 LoRA 件(API 图在场者)


def probe_base() -> str:
    for port in (17000, 17001):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats",
                                        timeout=3):
                return f"http://127.0.0.1:{port}"
        except Exception:
            continue
    raise RuntimeError("引擎 17000/17001 双口均无监听")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def png_pixel_sha(b: bytes) -> str:
    """PNG 图像数据(IDAT 解压)sha——排除 tEXt 嵌的 prompt 元数据,只比像素。"""
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


def png_chunkless_text_sha(b: bytes) -> str:
    """整文件 sha 但剔除文本元数据块(tEXt/zTXt/iTXt)——编码器+像素全同的佐证。"""
    off, kept = 8, [b[:8]]
    while off < len(b):
        (ln,) = struct.unpack(">I", b[off:off + 4])
        ctype = b[off + 4:off + 8]
        if ctype not in (b"tEXt", b"zTXt", b"iTXt"):
            kept.append(b[off:off + 12 + ln])
        off += 12 + ln
        if ctype == b"IEND":
            break
    return sha256_bytes(b"".join(kept))


def slot_widget_defaults() -> dict:
    """repo 真源 daojie_lora_stack.json → 栈 widget 缺省(单源,勿手抄)。"""
    slots = json.loads(STACK_JSON.read_text(encoding="utf-8"))
    widgets = {}
    for s in slots:
        widgets[f"enable_{s['key']}"] = True
        widgets[f"weight_{s['key']}"] = float(s["default_weight"])
    return widgets


def base_graph(base: str) -> dict:
    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop(
        "preview", None)
    graph = ui_to_api(wf, oi, {"12.seed": SEED, "53.width": WIDTH,
                               "53.height": HEIGHT})
    graph["80"]["inputs"].pop("negative", None)
    return graph


def stack_graph(a_graph: dict, preset: str, widgets: dict,
                with_base_link: bool = True) -> dict:
    """A 图派生栈节点版:摘 47/81/85,插 [90] MyDaojieLoraStack,重接 [12]/[86]。"""
    g = copy.deepcopy(a_graph)
    for nid in CURRENT_LORA_API_IDS:
        assert nid in g, f"现链 API 图缺 [{nid}](工作流已被动过?)"
        del g[nid]
    inputs = {"model": ["21", 0], "preset": preset, **widgets}
    if with_base_link:
        inputs["base"] = ["80", 4]
    g[STACK_NID] = {"class_type": "MyDaojieLoraStack", "inputs": inputs}
    assert g["12"]["inputs"]["model"] == ["85", 0], "A 图 [12].model 预期来自 [85]"
    g["12"]["inputs"]["model"] = [STACK_NID, 0]
    if "86" in g:  # 按型生效清单预览件改看栈节点 applied
        g["86"]["inputs"]["anything"] = [STACK_NID, 1]
    return g


def wait_idle(base: str) -> bool:
    t0 = time.time()
    while time.time() - t0 < IDLE_WAIT_MAX_S:
        q = http_json(f"{base}/queue", timeout=10)
        if not q.get("queue_running") and not q.get("queue_pending"):
            return True
        time.sleep(3)
    return False


def wait_done(base: str, pid: str) -> tuple[dict | None, float]:
    t0 = time.time()
    while time.time() - t0 < EXEC_TIMEOUT_S:
        hist = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in hist:
            return hist[pid], round(time.time() - t0, 2)
        time.sleep(POLL_S)
    return None, round(time.time() - t0, 2)


def first_image(entry: dict) -> dict | None:
    for _nid, out in (entry.get("outputs") or {}).items():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                for x in imgs:
                    if isinstance(x, dict) and x.get("filename"):
                        return x
    return None


def node_output_text(entry: dict, nid: str) -> str | None:
    out = (entry.get("outputs") or {}).get(nid) or {}
    texts = out.get("text") or []
    if isinstance(texts, list) and texts and isinstance(texts[0], str):
        return texts[0]
    return None


def lora_chain_graph(a_graph: dict, chain: list[tuple[str, float]]) -> dict:
    """顺序探针:21→[LoraLoaderModelOnly×N]→12(权值逐件给定)。"""
    g = copy.deepcopy(a_graph)
    for nid in CURRENT_LORA_API_IDS:
        del g[nid]
    prev = ["21", 0]
    for i, (rel, w) in enumerate(chain):
        nid = f"9{i + 1}"
        g[nid] = {"class_type": "LoraLoaderModelOnly",
                  "inputs": {"model": prev, "lora_name": rel,
                             "strength_model": w}}
        prev = [nid, 0]
    g["12"]["inputs"]["model"] = prev
    if "86" in g:
        del g["86"]  # 探针无 applied 可看
    return g


def run_one(base: str, name: str, graph: dict, expect_applied: str | None = None) -> dict:
    if not wait_idle(base):
        return {"name": name, "ran": False, "skip_reason": "引擎忙(礼让超时)"}
    resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT},
                     timeout=60)
    if resp.get("node_errors"):
        return {"name": name, "ran": False, "skip_reason": "node_errors",
                "detail": json.dumps(resp["node_errors"], ensure_ascii=False)[:800]}
    pid = resp["prompt_id"]
    entry, wall = wait_done(base, pid)
    if entry is None:
        return {"name": name, "ran": False, "skip_reason": f"超时>{EXEC_TIMEOUT_S}s",
                "prompt_id": pid}
    status = entry.get("status", {})
    if status.get("status_str") != "success":
        errs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
        return {"name": name, "ran": False, "skip_reason": "execution_failed",
                "detail": errs[:1], "prompt_id": pid}
    image = first_image(entry)
    if image is None:
        return {"name": name, "ran": False, "skip_reason": "history 无图",
                "prompt_id": pid}
    q = (f"filename={urllib.parse.quote(image['filename'])}"
         f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}&type=output")
    png = http_bytes(f"{base}/view?{q}")
    out = DOWNLOADS / f"{name}.png"
    out.write_bytes(png)
    rec = {"name": name, "ran": True, "prompt_id": pid, "wall_s": wall,
           "bytes": len(png), "png": str(out),
           "sha256": sha256_bytes(png), "pixel_sha": png_pixel_sha(png),
           "no_text_sha": png_chunkless_text_sha(png)}
    applied = node_output_text(entry, "86")
    if applied is not None:
        rec["applied"] = applied
    if expect_applied is not None:
        ok = expect_applied in (applied or "")
        rec["applied_ok"] = ok
        if not ok:
            rec["skip_reason"] = f"applied 校验失败: {applied!r}"
    print(f"[equiv] {name} wall={wall}s pixel={rec['pixel_sha'][:12]}", flush=True)
    return rec


def pair(a: dict, b: dict) -> dict:
    return {"a": a["name"], "b": b["name"],
            "ran": a.get("ran") and b.get("ran"),
            "pixel_equal": a.get("pixel_sha") == b.get("pixel_sha"),
            "no_text_equal": a.get("no_text_sha") == b.get("no_text_sha"),
            "full_file_equal": a.get("sha256") == b.get("sha256")}


def main() -> int:
    ap = argparse.ArgumentParser(description="LoRA 栈等价性双跑(切主链硬门禁)")
    ap.add_argument("--base-url", default="")
    ap.add_argument("--with-order-probe", action="store_true",
                    help="附跑顺序探针 67→73→76 vs 67→76→73(角色设定风险取证)")
    args = ap.parse_args()
    base = (args.base_url or probe_base()).rstrip("/")
    DOWNLOADS.mkdir(parents=True, exist_ok=True)

    a_graph = base_graph(base)
    # A 图形态断言:现链 = 21→47→81→85→12,85.base←[80]槽4
    assert a_graph["12"]["inputs"]["model"] == ["85", 0]
    assert a_graph["85"]["inputs"]["model"] == ["81", 0]
    assert a_graph["85"]["inputs"]["base"] == ["80", 4]
    assert a_graph["81"]["inputs"]["model"] == ["47", 0]
    assert a_graph["47"]["inputs"]["model"] == ["21", 0]
    assert a_graph["80"]["inputs"]["base"] == "人物", "A 基准型须=人物(现默认)"

    defaults = slot_widget_defaults()
    widgets = slot_widget_defaults()  # enable 全 True/权重=default_weight

    runs = [run_one(base, "A_current", a_graph)]
    b_graph = stack_graph(a_graph, "跟随底座型", widgets)
    assert b_graph["12"]["inputs"]["model"] == [STACK_NID, 0]
    runs.append(run_one(base, "B_stack_default", b_graph,
                        expect_applied="跟随底座型·人物(5/14)"))
    # C:现链全旁路基线(47/81/85 mode=4 → 穿透至 [21])
    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if n["id"] in (47, 81, 85):
            n["mode"] = 4
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop(
        "preview", None)
    c_graph = ui_to_api(wf, oi, {"12.seed": SEED, "53.width": WIDTH,
                                 "53.height": HEIGHT})
    c_graph["80"]["inputs"].pop("negative", None)
    assert c_graph["12"]["inputs"]["model"] == ["21", 0], "旁路基线 [12].model 应直连 [21]"
    runs.append(run_one(base, "C_bypass_baseline", c_graph))
    d_widgets = {k: False for k in defaults if k.startswith("enable_")}
    d_widgets.update({k: v for k, v in defaults.items()
                      if k.startswith("weight_")})
    runs.append(run_one(base, "D_stack_all_off",
                        stack_graph(a_graph, "专家·全自定义", d_widgets,
                                    with_base_link=False),
                        expect_applied="(0/14)"))
    e_widgets = {k: (0.0 if k.startswith("weight_") else True) for k in defaults}
    runs.append(run_one(base, "E_stack_weight0",
                        stack_graph(a_graph, "专家·全自定义", e_widgets,
                                    with_base_link=False),
                        expect_applied="(14/14)"))
    if args.with_order_probe:
        rel = {"detail": "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors",
               "liujin": "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors",
               "asianmix": "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors"}
        chain_a = [(rel["detail"], 1.0), (rel["liujin"], 0.4),
                   (rel["asianmix"], 1.0)]   # 角色设定现序:67→73→76
        chain_b = [(rel["detail"], 1.0), (rel["asianmix"], 1.0),
                   (rel["liujin"], 0.4)]     # 栈槽序将产出的:67→76→73
        runs.append(run_one(base, "P1_order_67_73_76",
                            lora_chain_graph(a_graph, chain_a)))
        runs.append(run_one(base, "P2_order_67_76_73",
                            lora_chain_graph(a_graph, chain_b)))

    by = {r["name"]: r for r in runs}
    gates = {
        "G1_default_group_equals_current_chain":
            pair(by["A_current"], by["B_stack_default"]),
        "G2_all_off_equals_bypass_baseline":
            pair(by["C_bypass_baseline"], by["D_stack_all_off"]),
        # 信息性(非门禁,09-19 实测恒不等):strength=0 走引擎补丁路径仍改字节
        # ——单件 turbo×0 亦不等旁路基线(model_patcher.patch_weight_to_device
        # 的 dtype 往返+stochastic_rounding 副作用);weight=0≠软关,enable=false
        # 才是真关(更慢+非中性双重证据,R2 设计依据)
        "G3_info_weight0_NOT_output_neutral":
            pair(by["C_bypass_baseline"], by["E_stack_weight0"]),
    }
    timing = {
        "D_all_off_enable_false_s": by["D_stack_all_off"].get("wall_s"),
        "E_weight0_s": by["E_stack_weight0"].get("wall_s"),
        "note": ("wall=提交→history 出现(0.5s 轮询);D 真关不装件,E 全装×0;"
                 "差额≈14 件 LoRA 加载+注册成本;E 先跑=含冷读,解读须带此注记"),
    }
    if args.with_order_probe and by.get("P1_order_67_73_76", {}).get("ran"):
        gates["G5_probe_order_sensitivity_73_76"] = pair(
            by["P1_order_67_73_76"], by["P2_order_67_76_73"])
    # 硬门禁=任务书口径:G1(默认组≡现链)+G2(全关≡旁路);计时为记录项;
    # G3/G5 为信息性(G3 恒不等=引擎补丁路径副作用,G5 证实链序敏感)
    hard = (gates["G1_default_group_equals_current_chain"]["ran"]
            and gates["G1_default_group_equals_current_chain"]["pixel_equal"]
            and gates["G2_all_off_equals_bypass_baseline"]["ran"]
            and gates["G2_all_off_equals_bypass_baseline"]["pixel_equal"])
    report = {"status": "done" if hard else "GATE_FAIL",
              "hard_gates_pass": hard, "gates": gates, "timing": timing,
              "common": {"seed": SEED, "width": WIDTH, "height": HEIGHT,
                         "base": "人物", "client": CLIENT},
              "runs": runs}
    (DOWNLOADS / "runs_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "runs"},
                     ensure_ascii=False, indent=1), flush=True)
    return 0 if hard else 1


if __name__ == "__main__":
    sys.exit(main())
