#!/usr/bin/env python3
"""道劫 NAG 速度档负向 A/B 实弹验证器(09-18)。

问题:速度档 KSampler cfg=1 下,采样器数学上不吃负向 conditioning,
[64] 道劫负向基线形同虚设——手部负面(多余手指/畸形的手)不设防。
NAG(Krea2NormalizedAttentionGuidance,引擎 object_info 实测 CATEGORY=
advanced/guidance)挂 MODEL 链,把负向做进模型补魂采样,与 cfg 解耦,
理论上可在 cfg1 下让负向复活。

A/B 设计(单变量=模型链上是否插 NAG,其余逐项相同):
  A 基线(现状):负向 [64] 原文 → [65] CLIPTextEncode → 12.negative 直连;
  B 实验:同 A,另在 [67] 与 [12] 之间插 [90] NAG——
          67.MODEL → 90.model;90.MODEL → 12.model;
          90.nag_negative ← [65] 负向编码输出(与 A 同一次编码、同一
          编码器 [15],保证负向文本两臂完全一致);
          参数=节点默认(object_info 逐字:phi4.0/tau2.5/alpha0.25/
          sigma_start1000.0/sigma_end0.0;本节点无 nag_scale,等价物=phi)。
  公共条件:真源 K2-文生图-道劫.json;[50] 主体句=露手句(双手交拢于
  身前,十指自然收拢清晰可见);seed=20260918;速度档 4步/cfg1/euler/
  simple;模型链旁路感知收敛 21→47→67→12(照 daojie_batch_engine_0918
  的 chain_from 修法——任务书规定激活集={47,67},真源文件当前 68/70/73
  三件 mode=0 属实验残留(标题与速查注记均自述"默认旁路"),脚本先归一
  旁路再链回溯,断言收敛恰为 [21,47,67])。

判定:两臂同种子出图后算像素差百分比(同尺寸逐通道 |A-B| 均值/255×100),
>1% 即负向在 cfg1 生效的铁证;手部是否改善交 analyze_image 目检对比。

产物:output/nag_ab_baseline.png(A)/ output/nag_ab_nag.png(B)。
用法:python3 daojie_nag_ab_0918.py
退出码 0=两臂成图且像素差已算出;1=任一臂失败(不编数据)。
"""
from __future__ import annotations

import copy
import json
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_handsfix_run_0917 import CLIENT, ui_to_api  # noqa: E402
from daojie_batch_engine_0918 import (  # noqa: E402
    ENGINE_BASES, MAX_RESUBMIT, EngineDisconnected,
    curl_alive, http_get_retry, http_json_retry, wait_engine_back,
)

REPO = Path.home() / "Project/Github/MYStudio"
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
OUT_A = REPO / "output/nag_ab_baseline.png"
OUT_B = REPO / "output/nag_ab_nag.png"
TIMEOUT_S = 1500

SEED = 20260918
# 露手主体句(七段公式,动作段=双手交拢十指可见,面朝观者保证手在画面内)
SUBJECT = (
    "一位女修士，青年金丹期，气质清冷出尘，肤色温润透亮，五官清隽；"
    "墨黑长发垂至腰际，发丝逐层分明；身着素色道袍长裙，米白纯色，素布质感，"
    "衣纹线条流畅；立于画面中央，面朝观者，双手交拢于身前，"
    "十指自然收拢清晰可见，目视前方，神色沉静；背景纯色浅净，大面积留白。"
)
ACTIVE_LORAS = {47, 67}       # 任务书规定:速度档默认激活(加速47+细节67)
EXPECTED_CHAIN = [21, 47, 67]  # 底模→加速→细节,收敛断言
NAG_ID = "90"
# NAG 参数=object_info 节点默认逐字(phi 即他版 nag_scale 的本节点等价物)
NAG_DEFAULTS = {"phi": 4.0, "tau": 2.5, "alpha": 0.25, "sigma_start": 1000.0, "sigma_end": 0.0}

_base = {"url": None}  # 当前引擎地址(17001 优先,实测可能落 17000)


def discover_base() -> str:
    """启动期引擎发现:先 17001 后 17000 探活;都不在则断线自愈等待。"""
    for b in ENGINE_BASES:
        if curl_alive(b):
            _base["url"] = b
            return b
    b = wait_engine_back()
    if b is None:
        raise RuntimeError(f"引擎 {ENGINE_BASES} 均不可达且 {900 // 60} 分钟未回")
    _base["url"] = b
    return b


def build_baseline_api() -> dict:
    """A 臂 API:真源改种子/主体句→激活集归一→官方流转换→链收敛 21→47→67→12。"""
    wf = json.loads(WF.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if n["id"] == 50:  # 主体句=露手句
            n["widgets_values"] = [SUBJECT]
            n["widgets_values_named"]["value"] = SUBJECT
        if n["id"] == 20:  # 种子(rgthree)
            n["widgets_values"] = [SEED, "", "", "okay"]
            n["widgets_values_named"]["seed"] = SEED
        if n["id"] == 12:  # 速度档原样锁定:4步/cfg1/euler/simple,种子固定
            n["widgets_values"] = [SEED, "fixed", 4, 1.0, "euler", "simple", 1]
            n["widgets_values_named"].update({"seed": SEED, "control_after_generate": "fixed"})
    # 激活集归一:任务书 {47,67} 之外的 LoRA 一律旁路(09-18 实测文件残留
    # 68/70/73 mode=0;其节点标题/速查注记均自述"默认旁路",归一无歧义)
    forced = []
    for n in wf["nodes"]:
        if n["type"] == "LoraLoaderModelOnly" and n["id"] not in ACTIVE_LORAS and n.get("mode", 0) != 4:
            forced.append(n["id"])
            n["mode"] = 4
    if forced:
        print(f"[nag-ab] 激活集归一:真源残留 mode=0 的 {sorted(forced)} 旁路(激活集={{47,67}})")
    modes = {n["id"]: n.get("mode", 0) for n in wf["nodes"]}
    api = ui_to_api(wf, http_json_retry(f"{_base['url']}/object_info"))

    # ── 模型链旁路感知收敛(照 daojie_batch_engine_0918.chain_from 修法)──
    def chain_from(ref):
        nid = int(ref[0])
        node = api[str(nid)]
        if node["class_type"] != "LoraLoaderModelOnly":
            return [nid]  # 到底模(UNETLoader)
        if modes.get(nid, 0) == 4:
            return chain_from(node["inputs"]["model"])  # 旁路:穿透取上游
        return [nid] + chain_from(node["inputs"]["model"])

    kept = chain_from(api["12"]["inputs"]["model"])  # 近端→远端,尾为底模
    kept.reverse()                                    # [21, ...激活LoRA...]
    prev = str(kept[0])
    for nid in kept[1:]:
        api[str(nid)]["inputs"]["model"] = [prev, 0]
        prev = str(nid)
    api["12"]["inputs"]["model"] = [prev, 0]
    keep_set = {str(x) for x in kept}
    dropped = [k for k, v in api.items()
               if v["class_type"] == "LoraLoaderModelOnly" and k not in keep_set]
    for k in dropped:
        del api[k]
    print("[nag-ab] model 链:" + "→".join(str(x) for x in kept + [12])
          + f"(mode 感知旁路,剔除 {len(dropped)} 件)")
    assert kept == EXPECTED_CHAIN, f"链未收敛到 {EXPECTED_CHAIN}:实际 {kept}"

    # 链路自检:负向直连现状 + 速度档参数
    n12 = api["12"]["inputs"]
    assert n12["model"] == ["67", 0], f"A 臂 12.model 应为 [67,0]:{n12['model']}"
    assert n12["negative"] == ["65", 0], f"A 臂 12.negative 应为 [65,0] 直连:{n12['negative']}"
    assert n12["cfg"] == 1.0 and n12["steps"] == 4, f"速度档参数漂移:{n12}"
    return api


def build_nag_api(a: dict) -> dict:
    """B 臂 API:A 深拷贝 + 仅两处变化——新增 [90] NAG、12.model 改指 [90]。"""
    b = copy.deepcopy(a)
    b[NAG_ID] = {
        "class_type": "Krea2NormalizedAttentionGuidance",
        "inputs": {"model": ["67", 0], "nag_negative": ["65", 0], **NAG_DEFAULTS},
        "_meta": {"title": "[90] NAG 实验件(负向经模型补魂进采样,cfg1 下复活)"},
    }
    b["12"]["inputs"]["model"] = [NAG_ID, 0]

    # 单变量自检:B 与 A 的差异必须恰为「新增 90 + 12.model 改指」,别处逐字节相同
    assert set(b) - set(a) == {NAG_ID}, f"B 臂多出的节点异常:{set(b) - set(a) - {NAG_ID}}"
    for k, v in a.items():
        if k != "12":
            assert b[k] == v, f"非单变量差异@节点 {k}"
    for k, v in a["12"]["inputs"].items():
        if k == "model":
            assert v == ["67", 0] and b["12"]["inputs"]["model"] == [NAG_ID, 0]
        else:
            assert b["12"]["inputs"][k] == v, f"12.{k} 两臂不一致"
    print(f"[nag-ab] 单变量自检通过:B = A + 节点{NAG_ID}(NAG)+ 12.model 改指;参数={NAG_DEFAULTS}")
    return b


def wait_idle(limit_s: int = 900) -> None:
    """队列礼让:等引擎空闲(用户实时任务优先),超时带队提交。"""
    t0 = time.time()
    while time.time() - t0 < limit_s:
        q = http_json_retry(f"{_base['url']}/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            return
        time.sleep(5)
    print("[nag-ab] 队列礼让超时,带队提交")


def gen_one(name: str, api: dict) -> bytes:
    """单臂一次完整提交(礼让→提交→轮询→/view 取图字节)。
    引擎执行错误/超时抛 RuntimeError;连接类异常重试耗尽抛 EngineDisconnected
    交由调用方断线自愈后同图重交。"""
    wait_idle()
    pid = http_json_retry(f"{_base['url']}/prompt", {"prompt": api, "client_id": CLIENT})["prompt_id"]
    print(f"[{name}] 提交 prompt_id={pid} seed={SEED}", flush=True)
    t0 = time.time()
    image = None
    while time.time() - t0 < TIMEOUT_S:
        time.sleep(6)
        h = http_json_retry(f"{_base['url']}/history/{pid}")
        if pid not in h:
            continue
        e = h[pid]
        if e.get("status", {}).get("status_str") == "error":
            raise RuntimeError(f"[{name}] 引擎执行错误:" + json.dumps(e["status"], ensure_ascii=False)[:600])
        for out in (e.get("outputs") or {}).values():
            for im in out.get("images", []) or []:
                if im.get("type") == "output":
                    image = im
                    break
        if image:
            break
    if not image:
        raise RuntimeError(f"[{name}] 超时 {TIMEOUT_S}s 无成图")
    q = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": "output"})
    data = http_get_retry(f"{_base['url']}/view?{q}")
    print(f"[{name}] ✅ {image['filename']} ({time.time()-t0:.0f}s, {len(data)//1024}KB)", flush=True)
    return data


def gen_with_heal(name: str, api: dict) -> bytes:
    """带断线自愈的出图:引擎断线→探活等待→回来后同图重交(≤MAX_RESUBMIT)。"""
    resubmits = 0
    while True:
        try:
            return gen_one(name, api)
        except EngineDisconnected as e:
            print(f"[{name}] 引擎断线:{e}", flush=True)
            if resubmits >= MAX_RESUBMIT:
                raise RuntimeError(f"[{name}] 重交达上限 {MAX_RESUBMIT} 次") from e
            b = wait_engine_back()
            if b is None:
                raise RuntimeError(f"[{name}] 引擎 15 分钟未回") from e
            _base["url"] = b
            resubmits += 1
            print(f"[{name}] 引擎已回 {b},同图重交({resubmits}/{MAX_RESUBMIT})", flush=True)


def pixel_diff(pa: Path, pb: Path) -> dict:
    """像素差:同尺寸逐通道 |A-B| 均值(ImageChops+ImageStat),报
    mean_abs(0-255)与 pct(均值/255×100,即全标度百分比=「均值差×100」)。"""
    from PIL import Image, ImageChops, ImageStat
    ia, ib = Image.open(pa).convert("RGB"), Image.open(pb).convert("RGB")
    if ia.size != ib.size:
        raise RuntimeError(f"尺寸不一致 {ia.size} vs {ib.size},无法逐像素比")
    per_ch = ImageStat.Stat(ImageChops.difference(ia, ib)).mean  # R/G/B 各均值
    mean_abs = sum(per_ch) / len(per_ch)
    return {
        "size": list(ia.size),
        "per_channel_mean_abs": [round(x, 3) for x in per_ch],
        "mean_abs_0_255": round(mean_abs, 3),
        "pixel_diff_pct": round(mean_abs / 255 * 100, 3),
    }


def main() -> int:
    base = discover_base()
    print(f"[nag-ab] 引擎 {base};真源 {WF.name};seed={SEED};cfg=1.0(速度档)")
    a = build_baseline_api()
    b = build_nag_api(a)

    OUT_A.parent.mkdir(parents=True, exist_ok=True)
    OUT_A.write_bytes(gen_with_heal("A-基线", a))
    OUT_B.write_bytes(gen_with_heal("B-NAG", b))
    diff = pixel_diff(OUT_A, OUT_B)
    verdict_eff = "负向在 cfg1 生效(像素差>1%)" if diff["pixel_diff_pct"] > 1 else "两臂同图,负向未生效(≤1%)"
    print(json.dumps({
        "status": "ok", "engine": base, "seed": SEED,
        "baseline_png": str(OUT_A), "nag_png": str(OUT_B),
        **diff, "negative_effective": diff["pixel_diff_pct"] > 1,
        "verdict_effect": verdict_eff,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
